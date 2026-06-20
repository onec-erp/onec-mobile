// Decides what tapping a server-contributed SSO button should do — kept as a pure function so the
// platform branch (the in-app broker auth-browser flow vs. the web startUrl round-trip) is
// unit-testable without pulling in App.tsx. The button still renders from the server's SsoProvider;
// only the handler is platform-specific, and there's no second hardcoded button.

export type SsoTap =
  /** Run the Telegram broker flow in an in-app auth browser. `fallbackHref` is the server's web flow,
   *  used if the broker flow can't run (server not broker-configured, or the browser fails). */
  | { kind: 'telegram-broker'; fallbackHref: string | null }
  /** Open this absolute URL in the system browser (the existing web SSO behavior). */
  | { kind: 'web'; href: string };

/**
 * Resolve an SSO button tap. `id` is the provider id (e.g. "telegram"); `to` is the provider's
 * `startUrl` carried on the action (a same-origin path), if any. Mirrors the web: navigate to a
 * same-origin `to`, else the OIDC `/oauth2/authorization/{id}` convention.
 *
 * Telegram runs the broker flow only on a native platform (where an in-app auth browser can capture
 * the `onno://` redirect); web — where that scheme can't round-trip — keeps the server's startUrl flow.
 */
export function resolveSsoTap(opts: {
  id: string;
  to: string | null;
  serverUrl: string;
  /** `Platform.OS` — 'ios' | 'android' | 'web' | … */
  platform: string;
}): SsoTap | null {
  const { id, to, serverUrl, platform } = opts;

  const path = to && to.startsWith('/') ? to : id ? `/oauth2/authorization/${id}` : null;
  const href = path ? `${serverUrl.replace(/\/$/, '')}${path}` : null;

  if (id === 'telegram' && platform !== 'web') {
    return { kind: 'telegram-broker', fallbackHref: href };
  }

  if (!href) return null;
  return { kind: 'web', href };
}
