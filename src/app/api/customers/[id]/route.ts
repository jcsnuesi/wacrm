import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { isUuid } from '@/lib/auth/active-account';

const CUSTOMER_DETAIL_SELECT = `
  id,
  display_name,
  first_name,
  last_name,
  email,
  phone,
  status,
  created_at,
  updated_at,
  contact_identities(
    id,
    channel,
    username,
    display_name,
    external_id,
    phone,
    last_seen_at
  ),
  conversations(
    id,
    status,
    last_message_text,
    last_message_at,
    channel_account:channel_accounts(channel, display_name)
  )
`;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { supabase, accountId } = await requireRole('viewer');
    if (!isUuid(id)) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      );
    }
    const { data, error } = await supabase
      .from('customers')
      .select(CUSTOMER_DETAIL_SELECT)
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      );
    }
    return NextResponse.json({ customer: data });
  } catch (error) {
    return toErrorResponse(error);
  }
}
