// Expo config plugin for the native "Login with Telegram" flow (modules/onno-telegram-login).
//
// It wires the platform glue the official Telegram login SDKs need, derived from your bot's app id
// (Telegram hosts the redirect at `https://app{appId}-login.tg.dev`):
//
//   iOS:
//     • Info.plist config the native module reads: TelegramLoginClientId / TelegramLoginRedirectUri
//       (https://app{appId}-login.tg.dev) / TelegramLoginScopes.
//     • Associated Domain `applinks:app{appId}-login.tg.dev` (entitlement) for the Universal-Link callback.
//     • LSApplicationQueriesSchemes `tg`/`tgapi` so the SDK can detect/open the Telegram app.
//     • Optional custom-scheme fallback (CFBundleURLTypes) when `iosCustomScheme` is set.
//   Android:
//     • <meta-data> config the native module reads: TelegramLoginClientId / TelegramLoginRedirectUri
//       (https://app{appId}-login.tg.dev/tglogin) / TelegramLoginScopes.
//     • A verified app-link intent-filter on MainActivity for that https host + path.
//       (Telegram package visibility lives in the module's own AndroidManifest.xml.)
//
// Usage (app.json):
//   ["./plugins/withTelegramLogin", {
//     "appId": "123456",                 // from @BotFather → Login Widget (the app{appId}-login.tg.dev id)
//     "clientId": "YOUR_BOT_CLIENT_ID",
//     "scopes": ["profile"],
//     "iosCustomScheme": "onno-telegram" // optional custom-scheme fallback
//   }]
//
// No secrets here — clientId/appId/redirect are public; the bot token + signing secrets live with
// @BotFather and the server. When appId/clientId are empty the plugin is a no-op (the native module
// then reports "unavailable" and the app falls back to the server's web SSO flow).

const {
  withInfoPlist,
  withEntitlementsPlist,
  withAndroidManifest,
  AndroidConfig,
} = require('@expo/config-plugins');

const TELEGRAM_QUERY_SCHEMES = ['tg', 'tgapi'];
const ANDROID_PATH = '/tglogin';

const domainFor = (appId) => `app${appId}-login.tg.dev`;

function withIos(config, { clientId, scopes, domain, iosCustomScheme }) {
  const redirectUri = `https://${domain}`;

  config = withInfoPlist(config, (cfg) => {
    const plist = cfg.modResults;

    // Config the native module reads at runtime.
    plist.TelegramLoginClientId = clientId;
    plist.TelegramLoginRedirectUri = redirectUri;
    plist.TelegramLoginScopes = scopes;

    // canOpenURL("tg://…") allow-list.
    const queries = new Set(plist.LSApplicationQueriesSchemes || []);
    TELEGRAM_QUERY_SCHEMES.forEach((s) => queries.add(s));
    plist.LSApplicationQueriesSchemes = Array.from(queries);

    // Optional custom-scheme fallback (yourapp://tglogin).
    if (iosCustomScheme) {
      plist.TelegramLoginCustomScheme = iosCustomScheme; // so the AppDelegate matches it precisely
      const urlTypes = plist.CFBundleURLTypes || [];
      const already = urlTypes.some((t) => (t.CFBundleURLSchemes || []).includes(iosCustomScheme));
      if (!already) {
        urlTypes.push({ CFBundleURLName: 'onno.telegram.login', CFBundleURLSchemes: [iosCustomScheme] });
      }
      plist.CFBundleURLTypes = urlTypes;
    }
    return cfg;
  });

  // Associated Domain for the Universal-Link callback.
  config = withEntitlementsPlist(config, (cfg) => {
    const key = 'com.apple.developer.associated-domains';
    const domains = new Set(cfg.modResults[key] || []);
    domains.add(`applinks:${domain}`);
    cfg.modResults[key] = Array.from(domains);
    return cfg;
  });

  return config;
}

function withAndroid(config, { clientId, scopes, domain }) {
  const redirectUri = `https://${domain}${ANDROID_PATH}`;

  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);

    // Config the native module reads at runtime.
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, 'TelegramLoginClientId', clientId);
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, 'TelegramLoginRedirectUri', redirectUri);
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, 'TelegramLoginScopes', scopes.join(','));

    // Verified app-link intent-filter for the redirect, on the main activity.
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
    activity['intent-filter'] = activity['intent-filter'] || [];
    const exists = activity['intent-filter'].some((f) =>
      (f.data || []).some((d) => d.$ && d.$['android:host'] === domain),
    );
    if (!exists) {
      activity['intent-filter'].push({
        $: { 'android:autoVerify': 'true' },
        action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
        category: [
          { $: { 'android:name': 'android.intent.category.DEFAULT' } },
          { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
        ],
        data: [
          {
            $: {
              'android:scheme': 'https',
              'android:host': domain,
              'android:pathPrefix': ANDROID_PATH,
            },
          },
        ],
      });
    }
    return cfg;
  });
}

/** @type {import('@expo/config-plugins').ConfigPlugin<{ appId?: string; clientId?: string; scopes?: string[]; iosCustomScheme?: string }>} */
const withTelegramLogin = (config, props = {}) => {
  const appId = (props.appId || '').trim();
  const clientId = (props.clientId || '').trim();
  const scopes = props.scopes && props.scopes.length ? props.scopes : ['profile'];

  // Not configured yet — leave the project untouched; the app falls back to the web SSO flow.
  if (!appId || !clientId) {
    return config;
  }

  const opts = { clientId, scopes, domain: domainFor(appId), iosCustomScheme: props.iosCustomScheme };
  config = withIos(config, opts);
  config = withAndroid(config, opts);
  return config;
};

module.exports = withTelegramLogin;
