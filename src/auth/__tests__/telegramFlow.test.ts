import { runTelegramNativeLogin, type TelegramFlowClient, type TelegramLoginFn } from '../telegramFlow';
import type { TelegramNativeUser } from '../../api/onnoClient';

const USER: TelegramNativeUser = { id: '42', username: 'durov', name: 'Pavel' };

/** A fake client that records the call order so we can assert the begin→login sequence. */
function makeClient(over: Partial<TelegramFlowClient> & { nonce?: string | null } = {}) {
  const calls: string[] = [];
  const client: TelegramFlowClient = {
    telegramNativeBegin: over.telegramNativeBegin
      ? over.telegramNativeBegin
      : jest.fn(async () => {
          calls.push('begin');
          return { nonce: over.nonce ?? 'nonce-123' };
        }),
    telegramNativeLogin: over.telegramNativeLogin
      ? over.telegramNativeLogin
      : jest.fn(async (idToken: string) => {
          calls.push(`login:${idToken}`);
          return USER;
        }),
  };
  return { client, calls };
}

describe('runTelegramNativeLogin — the begin → SDK → login sequence', () => {
  it('calls begin, passes the nonce to the SDK, then exchanges the idToken — in order', async () => {
    const { client, calls } = makeClient({ nonce: 'nonce-123' });
    const telegramLogin: TelegramLoginFn = jest.fn(async ({ nonce }) => {
      calls.push(`sdk:${nonce}`);
      return { idToken: 'jwt-abc', viaWebFallback: false };
    });

    const result = await runTelegramNativeLogin({ client, telegramLogin });

    expect(calls).toEqual(['begin', 'sdk:nonce-123', 'login:jwt-abc']);
    expect(telegramLogin).toHaveBeenCalledWith({ nonce: 'nonce-123' });
    expect(client.telegramNativeLogin).toHaveBeenCalledWith('jwt-abc');
    expect(result).toEqual({ user: USER, viaWebFallback: false });
  });

  it('still completes the login when /native/begin fails (nonce is optional)', async () => {
    const calls: string[] = [];
    const client: TelegramFlowClient = {
      telegramNativeBegin: jest.fn(async () => {
        throw new Error('404 — older server');
      }),
      telegramNativeLogin: jest.fn(async (idToken: string) => {
        calls.push(`login:${idToken}`);
        return USER;
      }),
    };
    const telegramLogin: TelegramLoginFn = jest.fn(async ({ nonce }) => {
      calls.push(`sdk:${nonce}`);
      return { idToken: 'jwt-xyz', viaWebFallback: false };
    });

    const result = await runTelegramNativeLogin({ client, telegramLogin });

    // SDK was called WITHOUT a nonce, login still ran, sequence preserved.
    expect(calls).toEqual(['sdk:undefined', 'login:jwt-xyz']);
    expect(result.user).toEqual(USER);
  });

  it('propagates the web-fallback flag from the SDK', async () => {
    const { client } = makeClient();
    const telegramLogin: TelegramLoginFn = jest.fn(async () => ({ idToken: 'jwt', viaWebFallback: true }));

    const result = await runTelegramNativeLogin({ client, telegramLogin });

    expect(result.viaWebFallback).toBe(true);
  });

  it('does NOT exchange a token when the SDK rejects (cancel/failure)', async () => {
    const { client } = makeClient();
    const telegramLogin: TelegramLoginFn = jest.fn(async () => {
      throw new Error('cancelled');
    });

    await expect(runTelegramNativeLogin({ client, telegramLogin })).rejects.toThrow('cancelled');
    expect(client.telegramNativeLogin).not.toHaveBeenCalled();
  });

  it('surfaces a 401 from the exchange to the caller', async () => {
    const { client } = makeClient();
    (client.telegramNativeLogin as jest.Mock).mockImplementation(async () => {
      throw new Error('telegram_login_failed');
    });
    const telegramLogin: TelegramLoginFn = jest.fn(async () => ({ idToken: 'jwt', viaWebFallback: false }));

    await expect(runTelegramNativeLogin({ client, telegramLogin })).rejects.toThrow('telegram_login_failed');
  });
});
