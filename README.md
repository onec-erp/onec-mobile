# Onno mobile

React Native + Expo (SDK 56) client for an Onno server. The login screen is **server-driven**: the
server returns a DivKit card describing whatever it offers — a password form and/or one button per
SSO provider (`SsoProvider{ id, label, startUrl }`) — and the app renders it and routes the taps.

> Expo has changed a lot between versions — read the exact versioned docs at
> <https://docs.expo.dev/versions/v56.0.0/> before writing native/config code.

## Develop

```bash
npm install
npm start            # Metro / Expo dev server
npm run ios          # build & run the iOS dev client
npm run android      # build & run the Android dev client
npm test             # Jest unit tests (auth flow logic)
npx tsc --noEmit     # type-check
```

The Telegram login flow below uses a custom URL scheme (`onno://`) and an in-app auth browser, so it
needs a **dev client / standalone build** (`expo-dev-client`) — the `onno://` redirect doesn't
round-trip in Expo Go.

---

## Login with Telegram (broker SSO)

The server-contributed Telegram SSO button runs **natively** through the **Onno Cloud broker** — one
shared bot for the whole ecosystem, no Telegram SDK, no per-bot native registration. The app opens the
broker in an in-app auth browser and captures the `onno://` redirect, so it's the *same* flow as the
web, ending in the same session. The button still renders from the server's `SsoProvider`; only the
**tap handler** is platform-specific.

### How it works

| Layer | File |
| --- | --- |
| Flow orchestration (begin → authorize+exchange → session) — pure, testable | [`src/auth/telegramAuth.ts`](src/auth/telegramAuth.ts) |
| The real auth-browser + PKCE implementation (expo-web-browser / expo-crypto) | [`src/auth/telegramBrokerBrowser.ts`](src/auth/telegramBrokerBrowser.ts) |
| Tap-handler branch (native broker vs. web) | [`src/auth/sso.ts`](src/auth/sso.ts) + `onAction`/`signInWithTelegram` in [`App.tsx`](App.tsx) |
| Server calls | `telegramNativeBegin()` / `telegramNativeLogin()` in [`src/api/onnoClient.ts`](src/api/onnoClient.ts) |

Tap sequence when `id === "telegram"` on a native build:

1. `POST /api/auth/telegram/native/begin` → `{ nonce, clientId, scopes, authorizationUri, tokenUri }`
   — the replay `nonce` plus this server's broker coordinates.
2. Open the broker's `authorizationUri` in an in-app auth browser
   (`WebBrowser.openAuthSessionAsync`) with the app's own PKCE pair, `state`, and
   `redirect_uri = onno://auth/telegram`. The broker authenticates upstream with Telegram and
   redirects back to `onno://auth/telegram?code=…`, which the auth session captures.
3. Exchange the `code` (+ PKCE `code_verifier`) at the broker's `tokenUri` → the broker's OIDC
   **`id_token`** (RS256).
4. `POST /api/auth/telegram/native` with `{ idToken }` through the **same `OnnoClient`** — on `200`
   the server's `Set-Cookie` session lands in the shared cookie jar, so it persists across relaunch
   and authenticates every later `/api/**` request. The app then refreshes auth state and enters.

#### One bot, many ERPs

Every server points at the same Onno Cloud broker; `/native/begin` returns *this* server's broker
`clientId` (which becomes the token `aud`) so one app signs into many ERPs with no per-bot config. The
bot itself lives only in the cloud — **the app holds no bot id or secret**, and there's no @BotFather
registration on the app side beyond owning the `onno://` URL scheme.

Each outcome is surfaced distinctly:

| Outcome | UX |
| --- | --- |
| Success | enters the app |
| User cancelled the auth-browser sheet | quiet "Telegram sign-in cancelled." toast |
| `401 telegram_login_failed` | error toast, stays on the login screen |
| Server not broker-configured / browser failed | **falls back to the server's web SSO flow** (`startUrl`) |

**Web** keeps opening `startUrl` (a custom scheme can't round-trip in a browser).

### Setup

The only app-side requirement is the URL scheme, already set in `app.json`:

```json
{ "expo": { "scheme": "onno", "plugins": ["expo-web-browser"] } }
```

Everything else lives in the cloud: see `onno-cloud` (`onno-cloud.telegram-auth.*` — the one bot and
its Web-Login secret) and `onno-enterprise`'s `onno-telegram-starter` (broker mode — each ERP points
its `onno.telegram.login.oauth.*` at `https://cloud.onno.su/auth/telegram` and sets its `client-id`).
The cross-repo design is in `onno-enterprise/docs/cloud-telegram-auth.md`.

### Tests

```bash
npm test
```

- `src/auth/__tests__/sso.test.ts` — the tap-handler branch: native (iOS/Android) → the broker flow;
  web → the server `startUrl`; non-Telegram providers untouched.
- `src/auth/__tests__/telegramAuth.test.ts` — the begin → authorize+exchange → session sequence and
  order, the scope default, the not-configured fall-through, and cancel propagation.
