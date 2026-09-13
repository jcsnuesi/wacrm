import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { supabase, accountId } = await requireRole('viewer');
    const { data, error } = await supabase
      .from('customers')
      .select('*, contact_identities(*), conversations(id, status, last_message_text, last_message_at, channel_accounts(channel, display_name))')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    return NextResponse.json({ customer: data });
  } catch (error) {
    return toErrorResponse(error);
  }
}
