import ExpoModulesCore

#if canImport(TelegramLogin)
import TelegramLogin
#endif

// Native bridge for "Login with Telegram" on iOS.
//
// Wraps Telegram's official login SDK (TelegramMessenger/telegram-login-ios, added via Swift Package
// Manager). The SDK opens the Telegram app when installed and otherwise presents a secure
// ASWebAuthenticationSession; on success it returns an OIDC ID token (a JWT) that the JS layer POSTs
// to /api/auth/telegram/native.
//
// Config (clientId / redirectUri / scopes) is written into Info.plist by the Expo config plugin
// (plugins/withTelegramLogin.js) so nothing is hardcoded here. The redirect callback is delivered by
// OnnoTelegramLoginAppDelegate (registered as an Expo AppDelegate subscriber) which forwards the URL
// to `TelegramLogin.handle(_:)`.
//
// Promise contract (consumed by src/auth/telegramLogin.ts):
//   resolve(["idToken": String, "viaWebFallback": Bool])
//   reject("ERR_TELEGRAM_CANCELLED", …)   — user dismissed the sheet
//   reject("ERR_TELEGRAM_UNAVAILABLE", …) — SDK not linked / not configured
//   reject("ERR_TELEGRAM_FAILED", …)      — anything else
//
// The `#if canImport(TelegramLogin)` guard keeps the module compiling even before the SPM package is
// added (it then reports "unavailable", so the app falls back to the server's web SSO flow).

public class OnnoTelegramLoginModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OnnoTelegramLogin")

    AsyncFunction("login") { (options: [String: Any?], promise: Promise) in
      let nonce = options["nonce"] as? String
      DispatchQueue.main.async {
        OnnoTelegramLoginModule.startLogin(nonce: nonce, promise: promise)
      }
    }
  }

  static func startLogin(nonce: String?, promise: Promise) {
    #if canImport(TelegramLogin)
    guard let cfg = TelegramLoginConfig.fromInfoPlist() else {
      promise.reject("ERR_TELEGRAM_UNAVAILABLE", "Telegram login is not configured. Add the plugin options in app.json (appId/clientId).")
      return
    }
    // `nonce` is reserved for replay protection; the current SDK doesn't take one, so it's bound by
    // the server (/api/auth/telegram/native/begin) rather than threaded through the SDK here.
    _ = nonce

    TelegramLoginConfig.ensureConfigured(cfg)

    TelegramLogin.login { result in
      switch result {
      case .success(let loginData):
        promise.resolve(["idToken": loginData.idToken, "viaWebFallback": false])
      case .failure(let error):
        switch error {
        case .cancelled:
          promise.reject("ERR_TELEGRAM_CANCELLED", "The user cancelled Telegram sign-in.")
        default:
          promise.reject("ERR_TELEGRAM_FAILED", error.localizedDescription)
        }
      }
    }
    #else
    _ = nonce
    promise.reject(
      "ERR_TELEGRAM_UNAVAILABLE",
      "Telegram login SDK is not linked in this build. Add it via Swift Package Manager — see modules/onno-telegram-login/README.md."
    )
    #endif
  }
}

#if canImport(TelegramLogin)
/// Reads the Info.plist values the config plugin writes, and configures the SDK once.
struct TelegramLoginConfig {
  let clientId: String
  let redirectUri: String
  let scopes: [String]

  private static var configured = false

  static func fromInfoPlist() -> TelegramLoginConfig? {
    let info = Bundle.main.infoDictionary
    guard
      let clientId = info?["TelegramLoginClientId"] as? String, !clientId.isEmpty,
      let redirectUri = info?["TelegramLoginRedirectUri"] as? String, !redirectUri.isEmpty
    else {
      return nil
    }
    let scopes = (info?["TelegramLoginScopes"] as? [String]) ?? ["profile"]
    return TelegramLoginConfig(clientId: clientId, redirectUri: redirectUri, scopes: scopes)
  }

  static func ensureConfigured(_ cfg: TelegramLoginConfig) {
    guard !configured else { return }
    TelegramLogin.configure(clientId: cfg.clientId, redirectUri: cfg.redirectUri, scopes: cfg.scopes)
    configured = true
  }

  /// Configure from Info.plist if possible (used at app launch by the AppDelegate subscriber).
  static func configureFromInfoPlistIfPossible() {
    if let cfg = fromInfoPlist() {
      ensureConfigured(cfg)
    }
  }
}
#endif
