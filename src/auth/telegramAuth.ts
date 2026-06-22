// "Login with Telegram" for the native app — the SAME flow as the web, run through an in-app auth
// browser against the Onno Cloud broker. No Telegram SDK, no per-bot native registration:
//
//   begin (nonce + broker coords) → open /authorize in an auth browser (ASWebAuthenticationSession /
//   Custom Tabs) → capture the onno:// redirect → exchange the code at the broker /token → POST the
//   id_token to /api/auth/telegram/native for a session cookie on our own HTTP client.
//
// This module is kept FREE of React/RN/expo so the sequence is unit-testable in isolation: the
// browser+PKCE half is injected as a `TelegramBrokerBrowser` (the real one lives in
// ./telegramBrokerBrowser; tests pass a fake). Only the orchestration and its tolerances live here.

import type { TelegramBrokerBegin, TelegramNativeUser } from '../api/onnoClient';

/** The custom scheme the broker redirects back to; registered in app.json (`scheme: "onno"`). */
export const TELEGRAM_REDIRECT_URI = 'onno://auth/telegram';

export type TelegramAuthErrorCode =
  /** The user dismissed the auth browser. */
  | 'cancelled'
  /** Anything else: not configured, state mismatch, exchange failed, … */
  | 'failed';

export class TelegramAuthError extends Error {
  constructor(public code: TelegramAuthErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'TelegramAuthError';
  }
}

/** The slice of OnnoClient this flow needs (kept narrow so tests can pass a fake). */
export interface TelegramFlowClient {
  telegramNativeBegin(): Promise<TelegramBrokerBegin>;
  telegramNativeLogin(idToken: string): Promise<TelegramNativeUser>;
}

/**
 * Opens the broker's `/authorize` in an in-app auth browser, captures the `onno://` redirect, and
 * exchanges the code at the broker `/token` (public PKCE client) — returning the broker-minted
 * `id_token`. Injected so the orchestrator can be tested without a device or a real browser.
 */
export interface TelegramBrokerBrowser {
  authorizeAndExchange(cfg: {
    authorizationUri: string;
    tokenUri: string;
    clientId: string;
    scopes: string[];
    nonce?: string;
  }): Promise<{ idToken: string }>;
}

export interface TelegramFlowResult {
  user: TelegramNativeUser;
}

/**
 * Drive the broker sign-in: ask the server for the nonce + broker coordinates, run the in-app browser
 * authorize+exchange, then trade the `id_token` for a session cookie on the SAME HTTP client — so the
 * cookie persists across relaunch and authenticates every later `/api/**` request.
 *
 * A server that doesn't advertise the broker coordinates (`authorizationUri`/`tokenUri`/`clientId`)
 * is reported as `failed`, which lets the caller fall back to the server's web SSO flow.
 */
export async function runTelegramBrokerLogin(deps: {
  client: TelegramFlowClient;
  browser: TelegramBrokerBrowser;
}): Promise<TelegramFlowResult> {
  const begun = await deps.client.telegramNativeBegin();
  if (!begun.authorizationUri || !begun.tokenUri || !begun.clientId) {
    throw new TelegramAuthError('failed', 'This server is not configured for Telegram broker login.');
  }

  const { idToken } = await deps.browser.authorizeAndExchange({
    authorizationUri: begun.authorizationUri,
    tokenUri: begun.tokenUri,
    clientId: begun.clientId,
    scopes: begun.scopes && begun.scopes.length ? begun.scopes : ['openid', 'profile'],
    nonce: begun.nonce ?? undefined,
  });

  const user = await deps.client.telegramNativeLogin(idToken);
  return { user };
}
