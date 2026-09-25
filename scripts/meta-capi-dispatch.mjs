const secret = process.env.META_CAPI_CRON_SECRET;

if (!secret) {
  console.error('META_CAPI_CRON_SECRET is not configured');
  process.exit(1);
}

const port = process.env.PORT || '3000';
const endpoint =
  process.env.META_CAPI_DISPATCH_URL ||
  `http://127.0.0.1:${port}/api/meta/capi/dispatch`;

try {
  const response = await fetch(endpoint, {
    headers: { 'x-cron-secret': secret },
    signal: AbortSignal.timeout(50_000),
  });
  const body = await response.text();
  console.log(body);
  if (!response.ok) process.exit(1);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Meta CAPI dispatch failed'
  );
  process.exit(1);
}
