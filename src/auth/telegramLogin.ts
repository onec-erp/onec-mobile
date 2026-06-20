// JS wrapper around the OnnoTelegramLogin native module (see modules/onno-telegram-login).
// Exposes a single `telegramLogin()` call plus typed errors, and degrades gracefully when
// the native module isn't linked — Expo Go, web, or a JS-only test run — so the rest of the
// app still builds and the SSO button can fall back to the server's web flow.
//
// The native module drives Telegram's official login SDK (TelegramMessenger/telegram-login-ios
// and …/telegram-login-android): it opens the Telegram app when installed and falls back to an
// in-app browser (ASWebAuthenticationSession / Custom Tab) otherwise, then resolves to the OIDC
// ID token (a JWT) we POST to /api/auth/telegram/native.

import { requireOptionalNativeModule } from 'expo-modules-core';

export interface TelegramLoginResult {
  /** The OIDC ID token (JWT) minted by Telegram's login SDK. POST it to /api/auth/telegram/native. */
  idToken: string;
  /** True when Telegram wasn't installed and the SDK completed via its web-auth fallback. */
  viaWebFallback: boolean;
}

export type TelegramLoginErrorCode =
  /** The user dismissed the Telegram / web-auth sheet. */
  | 'cancelled'
  /** The native module is not present in this build (Expo Go / web / SDK not wired). */
  | 'unavailable'
  /** The SDK errored (network, misconfiguration, denied, …). */
  | 'failed';

export class TelegramLoginError extends Error {
  constructor(public code: TelegramLoginErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'TelegramLoginError';
  }
}

interface NativeTelegramModule {
  login(options: { nonce?: string | null }): Promise<{ idToken: string; viaWebFallback?: boolean }>;
}

// `requireOptionalNativeModule` returns null instead of throwing when the module isn't linked,
// which is exactly the "fall back to the web flow" signal we want.
const native = requireOptionalNativeModule<NativeTelegramModule>('OnnoTelegramLogin');

/** Whether the native Telegram login SDK is linked (a dev-client / standalone build, not Expo Go/web). */
export function isTelegramLoginAvailable(): boolean {
  return native != null;
}

/** Run Telegram's official login SDK and resolve to an ID token (+ whether the web fallback was used). */
export async function telegramLogin(options: { nonce?: string } = {}): Promise<TelegramLoginResult> {
  if (!native) {
    throw new TelegramLoginError('unavailable', 'The Telegram login module is not available in this build.');
  }
  try {
    const res = await native.login({ nonce: options.nonce ?? null });
    return { idToken: res.idToken, viaWebFallback: res.viaWebFallback === true };
  } catch (e: any) {
    // Expo native modules reject with an Error whose `code` is the identifier we threw natively.
    const code = e?.code as string | undefined;
    if (code === 'ERR_TELEGRAM_CANCELLED') throw new TelegramLoginError('cancelled', 'Telegram sign-in was cancelled.');
    if (code === 'ERR_TELEGRAM_UNAVAILABLE') throw new TelegramLoginError('unavailable', e?.message);
    if (e instanceof TelegramLoginError) throw e;
    throw new TelegramLoginError('failed', e?.message ?? 'Telegram sign-in failed.');
  }
}
