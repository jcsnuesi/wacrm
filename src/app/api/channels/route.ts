import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { encrypt } from '@/lib/whatsapp/encryption';

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

/**
 * Connect a Meta social receiver to the active workspace. Tokens only cross
 * this server route and are encrypted before they reach `channel_accounts`.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      channel?: string;
      externalAccountId?: string;
      displayName?: string;
      username?: string;
      accessToken?: string;
    };
    if (body.channel !== 'instagram' && body.channel !== 'facebook') {
      return NextResponse.json(
        { error: 'Only Instagram and Facebook can be connected here' },
        { status: 400 }
      );
    }
    const externalAccountId = body.externalAccountId?.trim();
    const accessToken = body.accessToken?.trim();
    if (!externalAccountId || !accessToken) {
      return NextResponse.json(
        { error: 'The Meta account ID and access token are required' },
        { status: 400 }
      );
    }

    const { supabase, accountId } = await requireRole('admin');
    const { data: channelRow, error: channelError } = await supabase
      .from('channels')
      .select('id')
      .eq('code', body.channel.toUpperCase())
      .maybeSingle();
    if (channelError || !channelRow) {
      return NextResponse.json(
        { error: 'Channel catalogue is unavailable; verify migration 045' },
        { status: 500 }
      );
    }
    const { data, error } = await supabase
      .from('channel_accounts')
      .upsert(
        {
          account_id: accountId,
          channel_id: channelRow.id,
          channel: body.channel,
          provider: 'meta',
          external_account_id: externalAccountId,
          display_name: body.displayName?.trim() || null,
          username: body.username?.trim().replace(/^@/, '') || null,
          access_token_encrypted: encrypt(accessToken),
          metadata: { setup_source: 'settings', configured_at: new Date().toISOString() },
          status: 'connected',
        },
        { onConflict: 'account_id,channel,external_account_id' }
      )
      .select('id, channel, provider, external_account_id, display_name, username, status, token_expires_at, metadata, created_at, updated_at')
      .single();
    if (error) throw error;
    return NextResponse.json({ account: data }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
