// HTTP client for one OneC server — a TypeScript port of the Flutter client's
// `onec_client.dart`, trimmed to what the RN app needs so far (auth + DivKit
// card fetch).
//
// CSRF: the server sets a non-HttpOnly `XSRF-TOKEN` cookie and requires it
// echoed as `X-XSRF-TOKEN` on every mutating request. Native fetch manages the
// (HttpOnly) session cookie automatically, but we must read the XSRF token
// ourselves — we parse it out of the `Set-Cookie` response header (no native
// cookie module, so this works in Expo Go).

export interface AuthUser {
  authenticated: boolean;
  username: string;
  roles: string[];
}

export class OnecAuthError extends Error {}
export class OnecRequestError extends Error {
  constructor(public path: string, public status: number) {
    super(`Request to ${path} failed (HTTP ${status})`);
  }
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export class OnecClient {
  private csrf: string | null = null;

  constructor(public baseUrl: string) {}

  // ----- core -----

  private async request(
    path: string,
    opts: { method?: string; body?: unknown; query?: Record<string, string | undefined> } = {},
  ): Promise<Response> {
    const method = (opts.method ?? 'GET').toUpperCase();
    const url = this.baseUrl.replace(/\/$/, '') + path + queryString(opts.query);

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (MUTATING.has(method) && this.csrf) headers['X-XSRF-TOKEN'] = this.csrf;

    const res = await fetch(url, {
      method,
      headers,
      credentials: 'include',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    this.captureCsrf(res);
    return res;
  }

  /** Pull the rotating XSRF token out of the Set-Cookie response header. */
  private captureCsrf(res: Response): void {
    const setCookie = res.headers.get('set-cookie');
    if (!setCookie) return;
    const m = setCookie.match(/XSRF-TOKEN=([^;,\s]+)/);
    if (m) this.csrf = m[1];
  }

  private async json<T>(path: string, query?: Record<string, string | undefined>): Promise<T> {
    const res = await this.request(path, { query });
    if (res.status !== 200) throw new OnecRequestError(path, res.status);
    return (await res.json()) as T;
  }

  // ----- auth -----

  async me(): Promise<AuthUser> {
    const res = await this.request('/api/auth/me');
    if (res.status === 200) return normalizeUser(await res.json());
    return { authenticated: false, username: '', roles: [] };
  }

  async login(username: string, password: string): Promise<AuthUser> {
    // Seed the session + CSRF cookie before the (mutating) login POST.
    if (!this.csrf) await this.me();
    const res = await this.request('/api/auth/login', {
      method: 'POST',
      body: { username, password },
    });
    if (res.status === 200) return normalizeUser(await res.json());
    if (res.status === 401) throw new OnecAuthError('Invalid username or password');
    throw new OnecAuthError(`Login failed (HTTP ${res.status})`);
  }

  async logout(): Promise<void> {
    await this.request('/api/auth/logout', { method: 'POST' });
  }

  // ----- DivKit cards -----

  /** Content card for an app route. `/` → the dashboard (`/home`). */
  content(
    path: string,
    o: { viewport?: string; theme?: string; profile?: string } = {},
  ): Promise<{ templates?: Record<string, unknown>; card: unknown }> {
    const isHome = path === '/' || path === '';
    const url = isHome ? '/api/divkit/home' : `/api/divkit${path}`;
    return this.json(url, {
      viewport: o.viewport ?? 'mobile',
      theme: o.theme ?? 'light',
      profile: o.profile,
    });
  }

  /** Chrome card set: `{ navStyle, nav, account }`. */
  shell(o: { viewport?: string; theme?: string; profile?: string } = {}): Promise<unknown> {
    return this.json('/api/divkit/shell', {
      viewport: o.viewport ?? 'mobile',
      theme: o.theme ?? 'light',
      profile: o.profile,
    });
  }
}

function queryString(q?: Record<string, string | undefined>): string {
  if (!q) return '';
  const parts = Object.entries(q)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

function normalizeUser(j: any): AuthUser {
  return {
    authenticated: j?.authenticated === true,
    username: j?.username ?? '',
    roles: Array.isArray(j?.roles) ? j.roles.map(String) : [],
  };
}
