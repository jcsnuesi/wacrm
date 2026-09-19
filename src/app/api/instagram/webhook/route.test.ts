import { afterEach, describe, expect, it, vi } from 'vitest';

const processMetaWebhook = vi.fn();
const verifyMetaWebhookSignature = vi.fn();

vi.mock('@/lib/channels/meta-webhook', () => ({ processMetaWebhook }));
vi.mock('@/lib/whatsapp/webhook-signature', () => ({
  verifyMetaWebhookSignature,
}));

afterEach(() => vi.clearAllMocks());

describe('/api/instagram/webhook', () => {
  it('persists a valid event before acknowledging Meta', async () => {
    verifyMetaWebhookSignature.mockReturnValue(true);
    processMetaWebhook.mockResolvedValue(undefined);
    const { POST } = await import('./route');

    const response = await POST(
      new Request('http://localhost/api/instagram/webhook', {
        method: 'POST',
        headers: { 'x-hub-signature-256': 'sha256=valid' },
        body: JSON.stringify({
          entry: [{ id: 'ig-recipient', messaging: [] }],
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(processMetaWebhook).toHaveBeenCalledWith(
      'instagram',
      expect.anything(),
      expect.objectContaining({ entry: expect.any(Array) })
    );
  });

  it('returns 500 so Meta retries when persistence fails', async () => {
    verifyMetaWebhookSignature.mockReturnValue(true);
    processMetaWebhook.mockRejectedValue(new Error('Supabase unavailable'));
    const { POST } = await import('./route');

    const response = await POST(
      new Request('http://localhost/api/instagram/webhook', {
        method: 'POST',
        headers: { 'x-hub-signature-256': 'sha256=valid' },
        body: JSON.stringify({ entry: [] }),
      })
    );

    expect(response.status).toBe(500);
  });
});
