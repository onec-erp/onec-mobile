import { runTelegramBrokerLogin, TelegramAuthError, type TelegramBrokerBrowser } from '../telegramAuth';
import type { TelegramBrokerBegin, TelegramNativeUser } from '../../api/onnoClient';

// A fake OnnoClient slice: records the order of calls and the id_token it was handed.
function fakeClient(begin: TelegramBrokerBegin) {
  const calls: string[] = [];
  let exchangedIdToken: string | null = null;
  const client = {
    async telegramNativeBegin(): Promise<TelegramBrokerBegin> {
      calls.push('begin');
      return begin;
    },
    async telegramNativeLogin(idToken: string): Promise<TelegramNativeUser> {
      calls.push('login');
      exchangedIdToken = idToken;
      return { id: '42', username: 'ada', name: 'Ada' };
    },
  };
  return { client, calls, idToken: () => exchangedIdToken };
}

const FULL_BEGIN: TelegramBrokerBegin = {
  nonce: 'nonce-123',
  clientId: 'acme',
  scopes: ['openid', 'profile'],
  authorizationUri: 'https://cloud.onno.su/auth/telegram/authorize',
  tokenUri: 'https://cloud.onno.su/auth/telegram/token',
};

describe('runTelegramBrokerLogin — begin → authorize+exchange → session', () => {
  it('runs begin, drives the broker with THIS server\'s coords, then exchanges the id_token — in order', async () => {
    const { client, calls, idToken } = fakeClient(FULL_BEGIN);
    let sawCfg: any = null;
    const browser: TelegramBrokerBrowser = {
      async authorizeAndExchange(cfg) {
        sawCfg = cfg;
        return { idToken: 'broker-id-token' };
      },
    };

    const { user } = await runTelegramBrokerLogin({ client, browser });

    expect(calls).toEqual(['begin', 'login']); // begin before the session exchange
    expect(sawCfg).toEqual({
      authorizationUri: FULL_BEGIN.authorizationUri,
      tokenUri: FULL_BEGIN.tokenUri,
      clientId: 'acme',
      scopes: ['openid', 'profile'],
      nonce: 'nonce-123',
    });
    expect(idToken()).toBe('broker-id-token'); // the broker token is what opens the session
    expect(user.username).toBe('ada');
  });

  it('defaults scopes when the server omits them', async () => {
    const { client } = fakeClient({ ...FULL_BEGIN, scopes: undefined });
    let sawScopes: string[] = [];
    const browser: TelegramBrokerBrowser = {
      async authorizeAndExchange(cfg) {
        sawScopes = cfg.scopes;
        return { idToken: 't' };
      },
    };
    await runTelegramBrokerLogin({ client, browser });
    expect(sawScopes).toEqual(['openid', 'profile']);
  });

  it('fails (so the caller can fall back to web) when the server is not broker-configured', async () => {
    const { client, calls } = fakeClient({ nonce: null }); // no authorizationUri/tokenUri/clientId
    const browser: TelegramBrokerBrowser = {
      authorizeAndExchange: jest.fn(async () => ({ idToken: 'x' })),
    };
    await expect(runTelegramBrokerLogin({ client, browser })).rejects.toBeInstanceOf(TelegramAuthError);
    expect(browser.authorizeAndExchange).not.toHaveBeenCalled();
    expect(calls).toEqual(['begin']); // never reaches the session exchange
  });

  it('does NOT open a session when the browser flow is cancelled', async () => {
    const { client, calls } = fakeClient(FULL_BEGIN);
    const browser: TelegramBrokerBrowser = {
      async authorizeAndExchange() {
        throw new TelegramAuthError('cancelled', 'user dismissed');
      },
    };
    await expect(runTelegramBrokerLogin({ client, browser })).rejects.toMatchObject({ code: 'cancelled' });
    expect(calls).toEqual(['begin']); // login never called
  });
});
