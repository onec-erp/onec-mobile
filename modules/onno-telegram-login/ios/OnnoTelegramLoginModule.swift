import ExpoModulesCore
import AuthenticationServices

// Native bridge for "Login with Telegram" on iOS.
//
// Wraps Telegram's official login SDK (TelegramMessenger/telegram-login-ios). The SDK opens the
// Telegram app via its `tg://` deep link when installed, and otherwise falls back to
// ASWebAuthenticationSession; on success it returns an OIDC ID token (a JWT) that the JS layer
// POSTs to /api/auth/telegram/native.
//
// Promise contract (consumed by src/auth/telegramLogin.ts):
//   resolve(["idToken": String, "viaWebFallback": Bool])
//   reject("ERR_TELEGRAM_CANCELLED", …)   — user dismissed the sheet
//   reject("ERR_TELEGRAM_UNAVAILABLE", …) — SDK not wired into this build
//   reject("ERR_TELEGRAM_FAILED", …)      — anything else
//
// The callback redirect (Universal Link / custom scheme) and the LSApplicationQueriesSchemes("tg")
// allow-list are configured by the Expo config plugin: plugins/withTelegramLogin.js.

public class OnnoTelegramLoginModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OnnoTelegramLogin")

    AsyncFunction("login") { (options: [String: Any?], promise: Promise) in
      let nonce = options["nonce"] as? String
      self.startLogin(nonce: nonce, promise: promise)
    }
  }

  private func startLogin(nonce: String?, promise: Promise) {
    // The Telegram SDK touches UIKit / presents a sheet — keep it on the main thread.
    DispatchQueue.main.async {
      // ──────────────────────────────────────────────────────────────────────────────
      // TODO(native): wire the official Telegram login SDK here. Sketch of the expected
      // shape (confirm the exact symbols against the upstream README before building):
      //
      //   let request = TelegramLoginRequest(
      //     botID: <yourBotID>,            // the same bot registered for the web flow
      //     scope: .identity,
      //     nonce: nonce,
      //     callbackURL: URL(string: "onno-telegram://telegram-login")!
      //   )
      //   TelegramLogin.shared.authenticate(request, presentationAnchor: self.anchor()) { result in
      //     switch result {
      //     case .success(let token, let usedWebFallback):
      //       promise.resolve(["idToken": token, "viaWebFallback": usedWebFallback])
      //     case .cancelled:
      //       promise.reject("ERR_TELEGRAM_CANCELLED", "The user cancelled Telegram sign-in.")
      //     case .failure(let error):
      //       promise.reject("ERR_TELEGRAM_FAILED", error.localizedDescription)
      //     }
      //   }
      //   return
      // ──────────────────────────────────────────────────────────────────────────────

      // Until the SDK above is linked, report "unavailable" so the JS layer falls back to the
      // server's web SSO flow instead of dead-ending on the button.
      _ = nonce
      promise.reject(
        "ERR_TELEGRAM_UNAVAILABLE",
        "Telegram login SDK is not yet wired into this build. See modules/onno-telegram-login/README.md."
      )
    }
  }
}
