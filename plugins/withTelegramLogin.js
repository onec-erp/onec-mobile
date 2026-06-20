// Expo config plugin for the native "Login with Telegram" flow (modules/onno-telegram-login).
//
// It wires the platform glue the Telegram login SDK needs:
//   • iOS  — registers the callback URL scheme (CFBundleURLTypes), allow-lists `tg`/`tgapi` in
//            LSApplicationQueriesSchemes so the SDK can detect/open the Telegram app, and (optionally)
//            adds an Associated Domain when you redirect via a Universal Link.
//   • Android — adds an intent-filter on the main activity for the callback (app link / custom scheme).
//            (Telegram package visibility lives in the module's own AndroidManifest.xml.)
//
// Usage (app.json):
//   ["./plugins/withTelegramLogin", {
//     "scheme": "onno-telegram",                  // callback URL scheme (must match the native bridge)
//     "callbackHost": "telegram-login",           // optional path/host for the callback
//     "associatedDomain": "applinks:auth.example" // optional, only if using iOS Universal Links
//   }]
//
// No secrets here — the bot token and signing secrets live with @BotFather and the server.

const {
  withInfoPlist,
  withAndroidManifest,
  AndroidConfig,
} = require('@expo/config-plugins');

const DEFAULT_SCHEME = 'onno-telegram';
const DEFAULT_HOST = 'telegram-login';
// Schemes the SDK may probe to detect/open the installed Telegram app.
const TELEGRAM_QUERY_SCHEMES = ['tg', 'tgapi'];

/** @param {import('@expo/config-plugins').ConfigPlugin} */
function withTelegramLoginIos(config, { scheme, associatedDomain }) {
  config = withInfoPlist(config, (cfg) => {
    const plist = cfg.modResults;

    // LSApplicationQueriesSchemes — needed for canOpenURL("tg://") on iOS 9+.
    const queries = new Set(plist.LSApplicationQueriesSchemes || []);
    TELEGRAM_QUERY_SCHEMES.forEach((s) => queries.add(s));
    plist.LSApplicationQueriesSchemes = Array.from(queries);

    // CFBundleURLTypes — register the callback scheme so the SDK's web-auth fallback can return.
    const urlTypes = plist.CFBundleURLTypes || [];
    const already = urlTypes.some((t) => (t.CFBundleURLSchemes || []).includes(scheme));
    if (!already) {
      urlTypes.push({ CFBundleURLName: 'onno.telegram.login', CFBundleURLSchemes: [scheme] });
    }
    plist.CFBundleURLTypes = urlTypes;
    return cfg;
  });

  // Associated Domains (only when redirecting via a Universal Link).
  if (associatedDomain) {
    config.ios = config.ios || {};
    const domains = new Set(config.ios.associatedDomains || []);
    domains.add(associatedDomain);
    config.ios.associatedDomains = Array.from(domains);
  }

  return config;
}

/** @param {import('@expo/config-plugins').ConfigPlugin} */
function withTelegramLoginAndroid(config, { scheme, callbackHost }) {
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    const activity = (app.activity || []).find(
      (a) => a.$['android:name'] === '.MainActivity',
    );
    if (!activity) return cfg;

    activity['intent-filter'] = activity['intent-filter'] || [];
    const exists = activity['intent-filter'].some((f) =>
      (f.data || []).some((d) => d.$['android:scheme'] === scheme),
    );
    if (!exists) {
      activity['intent-filter'].push({
        $: { 'android:autoVerify': 'false' },
        action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
        category: [
          { $: { 'android:name': 'android.intent.category.DEFAULT' } },
          { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
        ],
        data: [{ $: { 'android:scheme': scheme, 'android:host': callbackHost } }],
      });
    }
    return cfg;
  });
}

/** @type {import('@expo/config-plugins').ConfigPlugin<{ scheme?: string; callbackHost?: string; associatedDomain?: string }>} */
const withTelegramLogin = (config, props = {}) => {
  const opts = {
    scheme: props.scheme || DEFAULT_SCHEME,
    callbackHost: props.callbackHost || DEFAULT_HOST,
    associatedDomain: props.associatedDomain,
  };
  config = withTelegramLoginIos(config, opts);
  config = withTelegramLoginAndroid(config, opts);
  return config;
};

module.exports = withTelegramLogin;
