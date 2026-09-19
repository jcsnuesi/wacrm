import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

/** Canonical Customer 360 list. Legacy contacts are intentionally omitted. */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('viewer');
    const searchParams = new URL(request.url).searchParams;
    const search = searchParams.get('q')?.trim();
    const requestedLimit = Number.parseInt(searchParams.get('limit') ?? '', 10);
    const requestedOffset = Number.parseInt(
      searchParams.get('offset') ?? '',
      10
    );
    const limit =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 100)
        : 100;
    const offset =
      Number.isFinite(requestedOffset) && requestedOffset >= 0
        ? requestedOffset
        : 0;
    let query = supabase
      .from('customers')
      .select(
        'id, display_name, first_name, last_name, email, phone, status, created_at, contact_identities(id, channel, username, display_name, external_id), conversations(id, status, last_message_at)',
        { count: 'exact' }
      )
      .eq('account_id', accountId)
      .order('updated_at', { ascending: false });
    if (search) {
      const safe = search.replace(/[%_,()]/g, '');
      if (safe)
        query = query.or(
          `display_name.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%`
        );
    }
    const { data, error, count } = await query.range(
      offset,
      offset + limit - 1
    );
    if (error) throw error;
    return NextResponse.json({ customers: data ?? [], total: count ?? 0 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
