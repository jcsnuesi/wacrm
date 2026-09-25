import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { dispatchMetaCapiOutbox } from '@/lib/meta/capi/worker';

export async function GET(request: Request) {
  const expected =
    process.env.META_CAPI_CRON_SECRET ?? process.env.AUTOMATION_CRON_SECRET;
  if (!expected)
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  const supplied =
    request.headers.get('x-cron-secret') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    '';
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await dispatchMetaCapiOutbox());
  } catch (error) {
    console.error('[Meta CAPI] dispatch failed', error);
    return NextResponse.json({ error: 'Dispatch failed' }, { status: 500 });
  }
}
