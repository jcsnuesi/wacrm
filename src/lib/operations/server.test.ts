import { afterEach, describe, expect, it, vi } from 'vitest';
import { foreignOrigin } from './server';

afterEach(() => vi.unstubAllEnvs());

describe('operations origin validation', () => {
  const request = (origin?: string, headers: Record<string, string> = {}) =>
    new Request('http://0.0.0.0:3000/api/operations', {
      method: 'POST',
      headers: { ...headers, ...(origin ? { origin } : {}) },
    });

  it('accepts the configured public HTTPS origin behind the proxy', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://crm.example.com/');
    expect(foreignOrigin(request('https://crm.example.com'))).toBe(false);
  });

  it.each(['https://evil.example', 'http://crm.example.com', 'null'])(
    'rejects a foreign origin (%s) even with spoofed forwarding headers',
    (origin) => {
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://crm.example.com');
      expect(
        foreignOrigin(
          request(origin, {
            'x-forwarded-host': 'evil.example',
            'x-forwarded-proto': 'https',
          })
        )
      ).toBe(true);
    }
  );

  it('uses the request origin when no public site URL is configured', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    expect(foreignOrigin(request('http://0.0.0.0:3000'))).toBe(false);
    expect(foreignOrigin(request('https://evil.example'))).toBe(true);
  });

  it('rejects requests with an Origin when the public URL is invalid', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'invalid-url');
    expect(foreignOrigin(request('https://crm.example.com'))).toBe(true);
  });

  it('preserves support for requests without an Origin header', () => {
    expect(foreignOrigin(request())).toBe(false);
  });
});
