import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

/** Canonical Customer 360 list. Legacy contacts are intentionally omitted. */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('viewer');
    const search = new URL(request.url).searchParams.get('q')?.trim();
    let query = supabase
      .from('customers')
      .select('id, display_name, first_name, last_name, email, phone, status, created_at, contact_identities(id, channel, username, display_name, external_id), conversations(id, status, last_message_at)')
      .eq('account_id', accountId)
      .order('updated_at', { ascending: false })
      .limit(100);
    if (search) {
      const safe = search.replace(/[%_,()]/g, '');
      if (safe) query = query.or(`display_name.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%`);
    }
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ customers: data ?? [] });
  } catch (error) {
    return toErrorResponse(error);
  }
}
