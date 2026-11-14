import { describe, expect, it, vi } from 'vitest';
import { runFailureActions } from './failure-actions';

describe('runFailureActions', () => {
  it('runs independent actions sequentially', async () => {
    const order: string[] = [];
    await runFailureActions([
      async () => {
        order.push('cleanup');
      },
      async () => {
        order.push('notify');
      },
    ]);
    expect(order).toEqual(['cleanup', 'notify']);
  });

  it('attempts notification and rejects the cleanup error for durable retry', async () => {
    const cleanupError = new Error('database unavailable');
    const notify = vi.fn(async () => undefined);
    await expect(
      runFailureActions([
        async () => {
          throw cleanupError;
        },
        notify,
      ])
    ).rejects.toBe(cleanupError);
    expect(notify).toHaveBeenCalledOnce();
  });

  it('propagates a notification error when cleanup succeeded', async () => {
    const notifyError = new Error('channel unavailable');
    const cleanup = vi.fn(async () => undefined);
    await expect(
      runFailureActions([
        cleanup,
        async () => {
          throw notifyError;
        },
      ])
    ).rejects.toBe(notifyError);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it.each([new Error('database unavailable'), undefined, null])(
    'retains the first thrown value when later actions also fail: %s',
    async (cleanupError) => {
      const notify = vi.fn(async () => {
        throw new Error('channel unavailable');
      });
      await expect(
        runFailureActions([
          async () => {
            throw cleanupError;
          },
          notify,
        ])
      ).rejects.toBe(cleanupError);
      expect(notify).toHaveBeenCalledOnce();
    }
  );

  it.each([
    new Error('Aborting engine: Grace period complete'),
    'Durable Object reset because its code was updated.',
  ])('stops immediately on an engine interruption: %s', async (abort) => {
    const notify = vi.fn(async () => undefined);
    await expect(
      runFailureActions([
        async () => {
          throw abort;
        },
        notify,
      ])
    ).rejects.toBe(abort);
    expect(notify).not.toHaveBeenCalled();
  });

  it('prioritizes a later engine interruption over an earlier cleanup error', async () => {
    const abort = new Error('Aborting engine: Grace period complete');
    const afterAbort = vi.fn(async () => undefined);
    await expect(
      runFailureActions([
        async () => {
          throw new Error('database unavailable');
        },
        async () => {
          throw abort;
        },
        afterAbort,
      ])
    ).rejects.toBe(abort);
    expect(afterAbort).not.toHaveBeenCalled();
  });
});
