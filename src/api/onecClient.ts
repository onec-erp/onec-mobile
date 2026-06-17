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

  /** Chrome card set: `{ navStyle, home, nav, account }`. */
  shell(o: { viewport?: string; theme?: string; profile?: string } = {}): Promise<{
    navStyle?: string;
    home?: string;
    nav?: { templates?: Record<string, unknown>; card: unknown };
    account?: { templates?: Record<string, unknown>; card: unknown };
  }> {
    return this.json('/api/divkit/shell', {
      viewport: o.viewport ?? 'mobile',
      theme: o.theme ?? 'light',
      profile: o.profile,
    });
  }

  // ----- generic entity REST (used by the custom widgets) -----

  /** Paged list rows: `GET /api/list/{kind}/{name}` → `{ total, offset, rows }`. */
  async listRows(
    kind: string,
    name: string,
    o: { q?: string; limit?: number; offset?: number; sort?: string; descending?: boolean } = {},
  ): Promise<{ total: number; offset: number; rows: Row[] }> {
    const data = await this.json<any>(`/api/list/${kind}/${name}`, {
      limit: String(o.limit ?? 100),
      offset: String(o.offset ?? 0),
      q: o.q || undefined,
      sort: o.sort || undefined,
      dir: o.sort ? (o.descending ? 'desc' : 'asc') : undefined,
    });
    return {
      total: Number(data?.total ?? 0),
      offset: Number(data?.offset ?? o.offset ?? 0),
      rows: asRows(data?.rows),
    };
  }

  /** Full row set: `GET /api/{kind}/{name}` (or a register's movements/turnover). */
  async rows(
    kind: string,
    name: string,
    o: { from?: string; to?: string; registerPath?: string } = {},
  ): Promise<Row[]> {
    const path = o.registerPath ? `/api/registers/${name}/${o.registerPath}` : `/api/${kind}/${name}`;
    const res = await this.request(path, { query: { from: o.from, to: o.to } });
    if (res.status !== 200) throw new OnecRequestError(path, res.status);
    return asRows(await res.json());
  }

  /** Typeahead for a ref picker: `GET /api/{kind}/{name}?q=&limit=`. */
  typeahead(kind: string, name: string, q: string, limit = 30): Promise<Row[]> {
    return this.json<any>(`/api/${kind}/${name}`, { q, limit: String(limit) }).then(asRows);
  }

  async createEntity(kind: string, name: string, body: Row): Promise<Row> {
    const res = await this.request(`/api/${kind}/${name}`, { method: 'POST', body });
    if (!ok(res)) throw new OnecRequestError(`/api/${kind}/${name}`, res.status);
    return (await res.json()) as Row;
  }

  async updateEntity(kind: string, name: string, id: string, body: Row): Promise<Row> {
    const res = await this.request(`/api/${kind}/${name}/${id}`, { method: 'PUT', body });
    if (!ok(res)) throw new OnecRequestError(`/api/${kind}/${name}/${id}`, res.status);
    return (await res.json()) as Row;
  }

  async deleteEntity(kind: string, name: string, id: string): Promise<void> {
    const res = await this.request(`/api/${kind}/${name}/${id}`, { method: 'DELETE' });
    if (!ok(res)) throw new OnecRequestError(`/api/${kind}/${name}/${id}`, res.status);
  }

  async postDocument(name: string, id: string): Promise<void> {
    const res = await this.request(`/api/documents/${name}/${id}/post`, { method: 'POST' });
    if (!ok(res)) throw new OnecRequestError(`/api/documents/${name}/${id}/post`, res.status);
  }

  async unpostDocument(name: string, id: string): Promise<void> {
    const res = await this.request(`/api/documents/${name}/${id}/unpost`, { method: 'POST' });
    if (!ok(res)) throw new OnecRequestError(`/api/documents/${name}/${id}/unpost`, res.status);
  }

  /** Run a custom list/detail action: `POST /api/actions/{kind}/{name}/{key}[?id=]`. */
  async runAction(
    kind: string,
    name: string,
    key: string,
    o: { id?: string; inputs?: Row } = {},
  ): Promise<{ message?: string; navigate?: string; refresh?: boolean }> {
    const res = await this.request(`/api/actions/${kind}/${name}/${key}`, {
      method: 'POST',
      query: { id: o.id },
      body: { inputs: o.inputs },
    });
    if (!ok(res)) throw new OnecRequestError(`/api/actions/${kind}/${name}/${key}`, res.status);
    const m = (await res.json()) as any;
    return { message: m?.message, navigate: m?.navigate, refresh: m?.refresh === true };
  }

  // ----- comments -----

  comments(kind: string, name: string, id: string): Promise<Row[]> {
    return this.json<any>(`/api/comments/${kind}/${name}/${id}`).then(asRows);
  }

  async addComment(kind: string, name: string, id: string, body: string): Promise<Row> {
    const res = await this.request(`/api/comments/${kind}/${name}/${id}`, {
      method: 'POST',
      body: { body },
    });
    if (!ok(res)) throw new OnecRequestError(`/api/comments/${kind}/${name}/${id}`, res.status);
    return (await res.json()) as Row;
  }

  async deleteComment(commentId: string): Promise<void> {
    const res = await this.request(`/api/comments/${commentId}`, { method: 'DELETE' });
    if (!ok(res)) throw new OnecRequestError(`/api/comments/${commentId}`, res.status);
  }
}

export type Row = Record<string, any>;

function ok(res: Response): boolean {
  return res.status >= 200 && res.status < 300;
}

function asRows(data: unknown): Row[] {
  if (Array.isArray(data)) return data.filter((x) => x && typeof x === 'object') as Row[];
  return [];
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
