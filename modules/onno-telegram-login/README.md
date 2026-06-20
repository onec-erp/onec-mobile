# onno-telegram-login (local Expo module)

Native **Login with Telegram** for the Onno mobile client. Wraps Telegram's official login SDKs so
the server-contributed Telegram SSO button works natively — no browser/WebView round-trip:

- iOS — [TelegramMessenger/telegram-login-ios](https://github.com/TelegramMessenger/telegram-login-ios)
- Android — [TelegramMessenger/telegram-login-android](https://github.com/TelegramMessenger/telegram-login-android)

It exposes one JS method, `login({ nonce? }) → { idToken, viaWebFallback }`, consumed by
[`src/auth/telegramLogin.ts`](../../src/auth/telegramLogin.ts). Because the app loads the module with
`requireOptionalNativeModule`, the JS bundle still builds where the native side is absent (Expo Go,
web, Jest), and the SSO button falls back to the server's web flow.

> Requires a **dev client / standalone build** (`expo-dev-client`). It does not run in Expo Go.

## Files

| Path | Purpose |
| --- | --- |
| `index.ts` | `requireNativeModule('OnnoTelegramLogin')` + types |
| `expo-module.config.json` | registers the native modules for autolinking |
| `ios/OnnoTelegramLoginModule.swift` | iOS bridge — wire the iOS SDK here (`TODO(native)`) |
| `ios/OnnoTelegramLogin.podspec` | adds `ExpoModulesCore` + the Telegram pod |
| `android/.../OnnoTelegramLoginModule.kt` | Android bridge — wire the Android SDK here (`TODO(native)`) |
| `android/build.gradle` | adds the Telegram SDK + Custom Tabs dep |
| `android/src/main/AndroidManifest.xml` | `<queries>` so the SDK can see/launch Telegram |

## Wiring the SDK (the `TODO(native)` blocks)

1. **Add the SDK dependency** — uncomment the `s.dependency 'TelegramLogin'` line in the podspec
   (or add the Swift Package to the dev client) and the `implementation 'org.telegram:login:…'` line
   in `build.gradle`, pinned to the version registered with @BotFather.
2. **Implement the bridge** — replace the `TODO(native)` block in each module file with the real SDK
   call, honoring the promise contract:
   - resolve `{ idToken, viaWebFallback }`
   - reject `ERR_TELEGRAM_CANCELLED` on user cancel
   - reject `ERR_TELEGRAM_FAILED` on any other error
   Until then the bridge rejects `ERR_TELEGRAM_UNAVAILABLE`, which makes the app fall back to the
   server's web SSO flow.
3. **Pass the same bot** used by the web flow, and the `nonce` argument (replay protection).

The redirect callback (Universal Link / app link / custom scheme `onno-telegram://telegram-login`)
and the platform allow-lists are configured by the Expo config plugin
[`plugins/withTelegramLogin.js`](../../plugins/withTelegramLogin.js). See the root
[`README.md`](../../README.md#login-with-telegram-native-sso) for the @BotFather registration steps.
