import { describe, expect, it, vi } from 'vitest';
import { retryDelayMs } from './worker';
import { sendMetaCapiEvent } from './client';

describe('sendMetaCapiEvent', () => {
  it('sends the token in the header and appends the test code', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ events_received: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const result = await sendMetaCapiEvent(
      {
        datasetId: '123',
        accessToken: 'secret',
        graphApiVersion: 'v25.0',
        testEventCode: 'TEST1',
      },
      { data: [{ event_name: 'Purchase' }] },
      fetcher
    );
    expect(result.ok).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      'https://graph.facebook.com/v25.0/123/events',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
        body: JSON.stringify({
          data: [{ event_name: 'Purchase' }],
          test_event_code: 'TEST1',
        }),
      })
    );
  });

  it.each([429, 500, 503])('marks HTTP %s as retryable', async (status) => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status }));
    const result = await sendMetaCapiEvent(
      { datasetId: '1', accessToken: 'x', graphApiVersion: 'v25.0' },
      { data: [] },
      fetcher
    );
    expect(result.retryable).toBe(true);
  });

  it('does not retry permanent validation errors', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 400 }));
    const result = await sendMetaCapiEvent(
      { datasetId: '1', accessToken: 'x', graphApiVersion: 'v25.0' },
      { data: [] },
      fetcher
    );
    expect(result.retryable).toBe(false);
  });
});

describe('retryDelayMs', () => {
  it('backs off exponentially and caps at one hour', () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(60_000);
    expect(retryDelayMs(20)).toBe(3_600_000);
  });
});
