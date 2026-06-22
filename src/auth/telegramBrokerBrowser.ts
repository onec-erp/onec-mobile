// The real TelegramBrokerBrowser: opens the Onno Cloud broker's /authorize in the platform auth
// browser (ASWebAuthenticationSession on iOS, Custom Tabs on Android), captures the onno:// redirect,
// and exchanges the code at the broker /token as a public PKCE client. Kept separate from
// telegramAuth.ts so that pure orchestrator stays free of expo modules (and unit-testable in node).

import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';

import { TELEGRAM_REDIRECT_URI, TelegramAuthError, type TelegramBrokerBrowser } from './telegramAuth';

// Finish any auth session left dangling by a reload / cold-start redirect (recommended by expo).
WebBrowser.maybeCompleteAuthSession();

// base64url alphabet — PKCE verifiers/challenges are unpadded base64url ([A-Za-z0-9-_]).
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function base64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64URL[b0 >> 2] + B64URL[((b0 & 3) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) out += B64URL[((b1 & 15) << 2) | (b2 >> 6)];
    if (i + 2 < bytes.length) out += B64URL[b2 & 63];
  }
  return out;
}

/** Parse the query string off a redirect URL (custom scheme or https). */
function parseQuery(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const q = url.indexOf('?');
  if (q < 0) return out;
  for (const pair of url.slice(q + 1).split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const k = decodeURIComponent(eq < 0 ? pair : pair.slice(0, eq));
    const v = eq < 0 ? '' : decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '));
    out[k] = v;
  }
  return out;
}

export const expoBrokerBrowser: TelegramBrokerBrowser = {
  async authorizeAndExchange(cfg) {
    // PKCE (S256) + a CSRF `state`. The verifier never leaves the device until the token exchange.
    const verifier = base64Url(Crypto.getRandomBytes(32));
    const state = base64Url(Crypto.getRandomBytes(16));
    const challengeB64 = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      verifier,
      { encoding: Crypto.CryptoEncoding.BASE64 },
    );
    const challenge = challengeB64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: cfg.clientId,
      redirect_uri: TELEGRAM_REDIRECT_URI,
      scope: cfg.scopes.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    if (cfg.nonce) params.set('nonce', cfg.nonce);
    const authUrl = cfg.authorizationUri + (cfg.authorizationUri.includes('?') ? '&' : '?') + params.toString();

    const result = await WebBrowser.openAuthSessionAsync(authUrl, TELEGRAM_REDIRECT_URI);
    if (result.type === 'cancel' || result.type === 'dismiss') {
      throw new TelegramAuthError('cancelled', 'Telegram sign-in was cancelled.');
    }
    if (result.type !== 'success' || !result.url) {
      throw new TelegramAuthError('failed', 'Telegram sign-in did not complete.');
    }
    const redirect = parseQuery(result.url);
    if (redirect.error) throw new TelegramAuthError('failed', redirect.error);
    if (redirect.state !== state) throw new TelegramAuthError('failed', 'State mismatch on the Telegram redirect.');
    if (!redirect.code) throw new TelegramAuthError('failed', 'No authorization code on the Telegram redirect.');

    // Redeem the code at the broker token endpoint — public client, PKCE is the proof (no secret).
    const res = await fetch(cfg.tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: redirect.code,
        code_verifier: verifier,
        redirect_uri: TELEGRAM_REDIRECT_URI,
        client_id: cfg.clientId,
      }).toString(),
    });
    if (!res.ok) {
      throw new TelegramAuthError('failed', `Broker token exchange failed (HTTP ${res.status}).`);
    }
    const json = (await res.json().catch(() => ({}))) as { id_token?: string };
    if (!json.id_token) {
      throw new TelegramAuthError('failed', 'The broker returned no id_token.');
    }
    return { idToken: json.id_token };
  },
};
