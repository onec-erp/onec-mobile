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

Native modules (incl. Telegram login below) require a **dev client / standalone build**
(`expo-dev-client`); they don't run in Expo Go.

---

## Login with Telegram (native SSO)

The same server-contributed Telegram SSO button works **natively** on the app — running Telegram's
official login SDK instead of the web/OIDC browser round-trip. The button still renders from the
server's `SsoProvider`; only the **tap handler** is platform-specific, and there's no second
hardcoded button.

### How it works

| Layer | File |
| --- | --- |
| Native module (iOS/Android bridge to the official SDKs) | [`modules/onno-telegram-login/`](modules/onno-telegram-login/) |
| Expo config plugin (Info.plist / AndroidManifest wiring) | [`plugins/withTelegramLogin.js`](plugins/withTelegramLogin.js) |
| JS wrapper (optional native binding + typed errors) | [`src/auth/telegramLogin.ts`](src/auth/telegramLogin.ts) |
| Flow orchestration (begin → SDK → exchange) | [`src/auth/telegramFlow.ts`](src/auth/telegramFlow.ts) |
| Tap-handler branch (native vs. web) | [`src/auth/sso.ts`](src/auth/sso.ts) + `onAction`/`signInWithTelegram` in [`App.tsx`](App.tsx) |
| Server calls | `telegramNativeBegin()` / `telegramNativeLogin()` in [`src/api/onnoClient.ts`](src/api/onnoClient.ts) |

Tap sequence when `id === "telegram"` on a native build with the module linked:

1. `POST /api/auth/telegram/native/begin` → `{ nonce }` (optional; replay protection).
2. `telegramLogin({ nonce })` — runs the SDK. It opens the **Telegram app** when installed, otherwise
   falls back to **ASWebAuthenticationSession** (iOS) / **Custom Tab** (Android). Resolves to an OIDC
   **ID token** (JWT).
3. `POST /api/auth/telegram/native` with `{ idToken }` through the **same `OnnoClient`** — on `200`
   the server's `Set-Cookie` session lands in the shared cookie jar, so it persists across relaunch
   and authenticates every later `/api/**` request. The app then refreshes auth state and enters.

Each outcome is surfaced distinctly:

| Outcome | UX |
| --- | --- |
| Success | enters the app |
| Telegram not installed → web-auth fallback succeeded | enters the app + an info toast |
| User cancelled the SDK sheet | quiet "Telegram sign-in cancelled." toast |
| `401 telegram_login_failed` | error toast, stays on the login screen |
| Native module not in this build | **falls back to the server's web SSO flow** (`startUrl`) |

**Web** (and any native build without the module) always keeps opening `startUrl`.

### Setup

#### 1. Register the app with @BotFather

Use the **same bot** as the web flow. In Telegram: **@BotFather → your bot → Bot Settings → Login
Widget**, and register the native apps:

- **iOS** — Bundle ID `su.onno.onnomobile` + your Apple **Team ID**.
- **Android** — package `su.onno.onnomobile` + the **SHA-256** signing-certificate fingerprint
  (one per signing key — debug, EAS, and Play App Signing each have their own; register all you use):

  ```bash
  keytool -list -v -keystore <your.keystore> -alias <alias> | grep SHA256
  ```

No secrets live in the app — the bot token and signing secrets stay with @BotFather and the server.

#### 2. Wire the official SDKs (the `TODO(native)` blocks)

The native bridges are scaffolded with the Expo Modules API and a clear promise contract, but the
actual SDK calls are marked `TODO(native)` (they reject `ERR_TELEGRAM_UNAVAILABLE` until wired, which
makes the app fall back to the web flow). To finish:

- iOS — add [`telegram-login-ios`](https://github.com/TelegramMessenger/telegram-login-ios) (pod or
  SPM) and implement `modules/onno-telegram-login/ios/OnnoTelegramLoginModule.swift`.
- Android — add [`telegram-login-android`](https://github.com/TelegramMessenger/telegram-login-android)
  and implement `modules/onno-telegram-login/android/.../OnnoTelegramLoginModule.kt`.

See [`modules/onno-telegram-login/README.md`](modules/onno-telegram-login/README.md) for the contract.

#### 3. Callback redirect

The config plugin registers the callback so the SDK's web-auth fallback can return:

- iOS — custom URL scheme `onno-telegram://telegram-login` (`CFBundleURLTypes`) and `tg`/`tgapi` in
  `LSApplicationQueriesSchemes`. For a **Universal Link** instead, pass `associatedDomain` to the
  plugin in `app.json` and host the AASA on that domain.
- Android — a `VIEW` intent-filter on `MainActivity` for the same scheme/host; Telegram package
  visibility (`<queries>`) ships in the module's manifest.

The callback URL must match what you register with @BotFather / the server. Configure it in
`app.json`:

```json
["./plugins/withTelegramLogin", { "scheme": "onno-telegram", "callbackHost": "telegram-login" }]
```

Then rebuild the dev client (`npm run ios` / `npm run android`) — config-plugin changes need a native
rebuild, not just a Metro reload.

### Tests

```bash
npm test
```

- `src/auth/__tests__/sso.test.ts` — the tap-handler branch: native (iOS/Android, module linked) →
  the SDK; web, and native-without-module → the server `startUrl`; non-Telegram providers untouched.
- `src/auth/__tests__/telegramFlow.test.ts` — the begin → SDK → exchange sequence and order, the
  optional-nonce tolerance, the web-fallback flag, and error propagation (SDK cancel, `401`).
