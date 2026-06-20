package expo.modules.onnotelegramlogin

import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise

// Native bridge for "Login with Telegram" on Android.
//
// Wraps Telegram's official login SDK (TelegramMessenger/telegram-login-android, GitHub Packages
// coordinate `org.telegram:login-sdk`). The SDK launches the Telegram app when installed and otherwise
// falls back to a Custom Tab; on success it returns an OIDC ID token (a JWT) that the JS layer POSTs
// to /api/auth/telegram/native.
//
// Config (clientId / redirectUri / scopes) is written into the manifest as <meta-data> by the Expo
// config plugin (plugins/withTelegramLogin.js), so nothing is hardcoded here. Telegram redirects to
// `https://app{appid}-login.tg.dev/tglogin`, which the config plugin maps to a verified app-link
// intent-filter on MainActivity → delivered here via `OnNewIntent`.
//
// The SDK is invoked through a thin reflection shim (TelegramLoginSdk) so this module still compiles
// and the Android app still builds when the SDK dependency isn't present (it then reports
// "unavailable", and the app falls back to the server's web SSO flow). Once you add the dependency
// (see modules/onno-telegram-login/README.md), the same calls bind to the real SDK. The equivalent
// direct calls are:
//
//   TelegramLogin.init(clientId, redirectUri, scopes)
//   TelegramLogin.startLogin(activity)
//   TelegramLogin.handleLoginResponse(uri, onSuccess = { it.idToken }, onError = { it.message })
//
// Promise contract (consumed by src/auth/telegramLogin.ts):
//   resolve(mapOf("idToken" to String, "viaWebFallback" to Boolean))
//   reject("ERR_TELEGRAM_CANCELLED" | "ERR_TELEGRAM_UNAVAILABLE" | "ERR_TELEGRAM_FAILED", …)

class OnnoTelegramLoginModule : Module() {
  private var pending: Promise? = null
  private var redirectHost: String? = null

  override fun definition() = ModuleDefinition {
    Name("OnnoTelegramLogin")

    AsyncFunction("login") { _: Map<String, Any?>, promise: Promise ->
      // The `nonce` option is reserved for replay protection; the current SDK doesn't take one, so
      // it's bound by the server (/api/auth/telegram/native/begin) rather than threaded through here.
      startLogin(promise)
    }

    OnNewIntent { intent ->
      val uri = intent.data ?: return@OnNewIntent
      onRedirect(uri)
    }
  }

  private fun startLogin(promise: Promise) {
    if (!TelegramLoginSdk.isAvailable) {
      promise.reject(
        "ERR_TELEGRAM_UNAVAILABLE",
        "Telegram login SDK is not linked in this build. See modules/onno-telegram-login/README.md.",
        null,
      )
      return
    }

    val context = appContext.currentActivity
    if (context == null) {
      promise.reject("ERR_TELEGRAM_FAILED", "No foreground activity to present Telegram login.", null)
      return
    }

    val cfg = TelegramLoginConfig.fromManifest(context)
    if (cfg == null) {
      promise.reject(
        "ERR_TELEGRAM_UNAVAILABLE",
        "Telegram login is not configured. Add the plugin options in app.json (appId/clientId).",
        null,
      )
      return
    }

    // A previous attempt that never received its redirect is superseded.
    pending?.reject("ERR_TELEGRAM_CANCELLED", "Superseded by a new Telegram sign-in.", null)
    pending = promise
    redirectHost = Uri.parse(cfg.redirectUri).host

    try {
      TelegramLoginSdk.init(cfg.clientId, cfg.redirectUri, cfg.scopes)
      TelegramLoginSdk.startLogin(context)
    } catch (e: Throwable) {
      pending = null
      promise.reject("ERR_TELEGRAM_FAILED", e.message ?: "Telegram sign-in failed.", e)
    }
  }

  private fun onRedirect(uri: Uri) {
    // Ignore deep links that aren't our Telegram callback.
    if (redirectHost != null && uri.host != redirectHost) return
    val promise = pending ?: return
    pending = null

    try {
      TelegramLoginSdk.handleLoginResponse(
        uri,
        onSuccess = { idToken -> promise.resolve(mapOf("idToken" to idToken, "viaWebFallback" to false)) },
        onError = { message -> promise.reject("ERR_TELEGRAM_FAILED", message ?: "Telegram sign-in failed.", null) },
      )
    } catch (e: Throwable) {
      promise.reject("ERR_TELEGRAM_FAILED", e.message ?: "Telegram sign-in failed.", e)
    }
  }
}

/** Reads the <meta-data> the config plugin writes into the manifest. */
private data class TelegramLoginConfig(
  val clientId: String,
  val redirectUri: String,
  val scopes: List<String>,
) {
  companion object {
    fun fromManifest(context: Context): TelegramLoginConfig? {
      val app = context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
      val meta = app.metaData ?: return null
      val clientId = meta.getString("TelegramLoginClientId")?.takeIf { it.isNotEmpty() } ?: return null
      val redirectUri = meta.getString("TelegramLoginRedirectUri")?.takeIf { it.isNotEmpty() } ?: return null
      val scopes = meta.getString("TelegramLoginScopes")
        ?.split(",")
        ?.map { it.trim() }
        ?.filter { it.isNotEmpty() }
        ?: listOf("profile")
      return TelegramLoginConfig(clientId, redirectUri, scopes)
    }
  }
}

/**
 * Reflection shim over `org.telegram.login.TelegramLogin`. Keeps the module building when the SDK
 * dependency is absent; binds to it transparently when present. (Telegram ships the SDK via GitHub
 * Packages, which needs a personal access token, so we can't make it an unconditional dependency.)
 */
private object TelegramLoginSdk {
  private val clazz: Class<*>? = try {
    Class.forName("org.telegram.login.TelegramLogin")
  } catch (e: Throwable) {
    null
  }

  // Kotlin `object` → singleton in the INSTANCE field; fall back to static methods.
  private val instance: Any? = clazz?.let {
    try {
      it.getField("INSTANCE").get(null)
    } catch (e: Throwable) {
      null
    }
  }

  val isAvailable: Boolean get() = clazz != null

  private fun method(name: String, paramCount: Int) =
    clazz?.methods?.firstOrNull { it.name == name && it.parameterTypes.size == paramCount }
      ?: throw NoSuchMethodException("org.telegram.login.TelegramLogin.$name/$paramCount")

  fun init(clientId: String, redirectUri: String, scopes: List<String>) {
    method("init", 3).invoke(instance, clientId, redirectUri, scopes)
  }

  fun startLogin(context: Context) {
    method("startLogin", 1).invoke(instance, context)
  }

  fun handleLoginResponse(uri: Uri, onSuccess: (String) -> Unit, onError: (String?) -> Unit) {
    // SDK signature: handleLoginResponse(uri, onSuccess: (LoginData) -> Unit, onError: (Error) -> Unit).
    // Kotlin lambdas are Function1 instances, so they pass straight through; we just unwrap the
    // `idToken` / `message` properties off the opaque result objects via their getters.
    val success: (Any?) -> Unit = { data -> onSuccess(getProp(data, "getIdToken") ?: "") }
    val error: (Any?) -> Unit = { err -> onError(getProp(err, "getMessage")) }
    method("handleLoginResponse", 3).invoke(instance, uri, success, error)
  }

  private fun getProp(obj: Any?, getter: String): String? {
    if (obj == null) return null
    return try {
      obj.javaClass.getMethod(getter).invoke(obj) as? String
    } catch (e: Throwable) {
      obj.toString()
    }
  }
}
