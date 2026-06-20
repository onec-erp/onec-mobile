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
| Native module (iOS/Android bridges, wired to the official SDKs) | [`modules/onno-telegram-login/`](modules/onno-telegram-login/) |
| Expo config plugin (Info.plist / entitlements / manifest wiring) | [`plugins/withTelegramLogin.js`](plugins/withTelegramLogin.js) |
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

Telegram then gives you an **app id** and a **client id**. The app id forms the hosted redirect domain
`app{appId}-login.tg.dev` (no AASA/asset-links hosting needed on your side — Telegram hosts it). No
secrets live in the app; the bot token and signing secrets stay with @BotFather and the server.

#### 2. Configure the plugin

Set the ids in `app.json` (leave empty to keep the web flow):

```json
["./plugins/withTelegramLogin", {
  "appId": "123456",
  "clientId": "YOUR_BOT_CLIENT_ID",
  "scopes": ["profile"],
  "iosCustomScheme": "onno-telegram"
}]
```

The plugin writes the SDK config (client id, `https://app{appId}-login.tg.dev` redirect, scopes) into
Info.plist / manifest `<meta-data>`, adds the iOS Associated Domain + Android verified app-link
intent-filter for the callback, and allow-lists `tg` in `LSApplicationQueriesSchemes`. The native
bridges read that config and drive the SDK — the callback is delivered automatically (iOS AppDelegate
subscriber → `TelegramLogin.handle`, Android `OnNewIntent` → `handleLoginResponse`).

#### 3. Add the SDK to each platform

The bridges are implemented but compile/run **with or without** the SDK linked (falling back to the
web flow until it's present). To turn it on:

- **iOS** — Xcode → *File → Add Package Dependencies…* →
  `https://github.com/TelegramMessenger/telegram-login-ios`, add to the app target.
- **Android** — add the GitHub Packages maven repo (with a `gpr.user`/`gpr.key` token) to
  `android/settings.gradle` and uncomment `implementation 'org.telegram:login-sdk:1.0.0'` in
  `modules/onno-telegram-login/android/build.gradle`.

Full snippets in [`modules/onno-telegram-login/README.md`](modules/onno-telegram-login/README.md).
Then rebuild the dev client (`npm run ios` / `npm run android`) — native/config-plugin changes need a
native rebuild, not just a Metro reload.

### Tests

```bash
npm test
```

- `src/auth/__tests__/sso.test.ts` — the tap-handler branch: native (iOS/Android, module linked) →
  the SDK; web, and native-without-module → the server `startUrl`; non-Telegram providers untouched.
- `src/auth/__tests__/telegramFlow.test.ts` — the begin → SDK → exchange sequence and order, the
  optional-nonce tolerance, the web-fallback flag, and error propagation (SDK cancel, `401`).
