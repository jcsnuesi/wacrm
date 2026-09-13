import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

/**
 * Read-only inventory for Settings → Channels. Credentials are deliberately
 * excluded; provider setup remains server-side and channel-specific.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('viewer');
    const { data, error } = await supabase
      .from('channel_accounts')
      .select(
        'id, channel, provider, external_account_id, display_name, username, status, token_expires_at, metadata, created_at, updated_at'
      )
      .eq('account_id', accountId)
      .order('channel')
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('[channels] unable to list channel accounts:', error);
      return NextResponse.json(
        { error: 'Unable to load channel accounts' },
        { status: 500 }
      );
    }

    return NextResponse.json({ accounts: data ?? [] });
  } catch (error) {
    return toErrorResponse(error);
  }
}
