package expo.modules.onnotelegramlogin

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise

// Native bridge for "Login with Telegram" on Android.
//
// Wraps Telegram's official login SDK (TelegramMessenger/telegram-login-android). The SDK launches
// the Telegram app when installed and otherwise falls back to a Chrome Custom Tab; on success it
// returns an OIDC ID token (a JWT) that the JS layer POSTs to /api/auth/telegram/native.
//
// Promise contract (consumed by src/auth/telegramLogin.ts):
//   resolve(mapOf("idToken" to String, "viaWebFallback" to Boolean))
//   reject("ERR_TELEGRAM_CANCELLED", …)   — user dismissed the flow
//   reject("ERR_TELEGRAM_UNAVAILABLE", …) — SDK not wired into this build
//   reject("ERR_TELEGRAM_FAILED", …)      — anything else
//
// The callback redirect (app link / custom scheme) intent-filter and the <queries> Telegram-package
// allow-list are configured by the Expo config plugin: plugins/withTelegramLogin.js (+ this module's
// AndroidManifest.xml).

class OnnoTelegramLoginModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OnnoTelegramLogin")

    AsyncFunction("login") { options: Map<String, Any?>, promise: Promise ->
      val nonce = options["nonce"] as? String
      startLogin(nonce, promise)
    }
  }

  private fun startLogin(nonce: String?, promise: Promise) {
    val activity = appContext.currentActivity
    if (activity == null) {
      promise.reject("ERR_TELEGRAM_FAILED", "No foreground activity to present Telegram login.", null)
      return
    }

    // ────────────────────────────────────────────────────────────────────────────────
    // TODO(native): wire the official Telegram login SDK here. Sketch of the expected
    // shape (confirm the exact symbols against the upstream README before building):
    //
    //   val request = TelegramLoginRequest.Builder(botId = <yourBotId>)
    //     .scope(Scope.IDENTITY)
    //     .nonce(nonce)
    //     .callbackUrl("onno-telegram://telegram-login")
    //     .build()
    //   TelegramLogin.authenticate(activity, request, object : TelegramLoginCallback {
    //     override fun onSuccess(idToken: String, viaWebFallback: Boolean) {
    //       promise.resolve(mapOf("idToken" to idToken, "viaWebFallback" to viaWebFallback))
    //     }
    //     override fun onCancelled() {
    //       promise.reject("ERR_TELEGRAM_CANCELLED", "The user cancelled Telegram sign-in.", null)
    //     }
    //     override fun onError(error: Throwable) {
    //       promise.reject("ERR_TELEGRAM_FAILED", error.message, error)
    //     }
    //   })
    //   return
    // ────────────────────────────────────────────────────────────────────────────────

    // Until the SDK above is linked, report "unavailable" so the JS layer falls back to the
    // server's web SSO flow instead of dead-ending on the button.
    @Suppress("UNUSED_EXPRESSION") nonce
    promise.reject(
      "ERR_TELEGRAM_UNAVAILABLE",
      "Telegram login SDK is not yet wired into this build. See modules/onno-telegram-login/README.md.",
      null
    )
  }
}
