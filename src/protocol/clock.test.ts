import { describe, expect, it, vi } from 'vitest';
import { ClockSync } from './clock';
import { YuzuError } from './types';

describe('ClockSync', () => {
  it('selects the offset from the minimum-rtt sample', async () => {
    const localTimes = [1_000, 1_100, 2_000, 2_020, 3_000, 3_050, 4_000];
    const now = vi.fn(() => {
      const value = localTimes.shift();
      if (value === undefined) {
        throw new Error('unexpected clock read');
      }
      return value;
    });
    const serverTimes = [1_200, 2_110, 3_500];
    const request = vi.fn(async (_type: string, data?: unknown) => {
      const serverTime = serverTimes.shift();
      if (serverTime === undefined) {
        throw new Error('unexpected ping');
      }
      if (
        data === null ||
        typeof data !== 'object' ||
        !('client_time' in data) ||
        typeof data.client_time !== 'number'
      ) {
        throw new Error('invalid ping');
      }
      return { client_time: data.client_time, server_time: serverTime };
    });
    const clock = new ClockSync(request, now);

    await clock.sync(3);

    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenNthCalledWith(1, 'ping', { client_time: 1_000 });
    expect(request).toHaveBeenNthCalledWith(2, 'ping', { client_time: 2_000 });
    expect(request).toHaveBeenNthCalledWith(3, 'ping', { client_time: 3_000 });
    expect(clock.synced).toBe(true);
    expect(clock.offset).toBe(100);
    expect(clock.serverNow()).toBe(4_100);
  });

  it('defaults to five rounds and leaves a previous estimate intact on a failed resync', async () => {
    let localTime = 10_000;
    const request = vi.fn(async (_type: string, data?: unknown) => {
      if (
        data === null ||
        typeof data !== 'object' ||
        !('client_time' in data) ||
        typeof data.client_time !== 'number'
      ) {
        throw new Error('invalid ping');
      }
      localTime += 10;
      return { client_time: data.client_time, server_time: data.client_time + 45 };
    });
    const clock = new ClockSync(request, () => localTime);

    await clock.sync();
    expect(request).toHaveBeenCalledTimes(5);
    expect(clock.offset).toBe(40);

    request.mockRejectedValueOnce(new Error('network down'));
    await expect(clock.sync()).rejects.toThrow('network down');
    expect(clock.synced).toBe(true);
    expect(clock.offset).toBe(40);
  });

  it('rejects invalid round counts and malformed pong data', async () => {
    const clock = new ClockSync(async () => ({ nope: true }), () => 1);

    await expect(clock.sync(0)).rejects.toEqual(
      expect.objectContaining<Partial<YuzuError>>({ code: 'bad_request' }),
    );
    await expect(clock.sync(1)).rejects.toEqual(
      expect.objectContaining<Partial<YuzuError>>({
        code: 'internal',
        message: 'invalid pong response',
      }),
    );
  });
});
