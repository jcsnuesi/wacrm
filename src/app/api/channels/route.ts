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

    // A workspace has one active social inbox per channel. Keep prior
    // connections for audit/history, but make them inert before activating the
    // replacement so webhooks can no longer route messages through them.
    const { error: disconnectPreviousError } = await supabase
      .from('channel_accounts')
      .update({
        status: 'disconnected',
        access_token_encrypted: null,
        refresh_token_encrypted: null,
        token_expires_at: null,
      })
      .eq('account_id', accountId)
      .eq('channel', body.channel)
      .eq('status', 'connected');
    if (disconnectPreviousError) throw disconnectPreviousError;

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
          metadata: {
            setup_source: 'settings',
            configured_at: new Date().toISOString(),
          },
          status: 'connected',
        },
        { onConflict: 'account_id,channel,external_account_id' }
      )
      .select(
        'id, channel, provider, external_account_id, display_name, username, status, token_expires_at, metadata, created_at, updated_at'
      )
      .single();
    if (error) throw error;
    return NextResponse.json({ account: data }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Disconnect an account without deleting its history. Webhook processing only
 * selects rows whose status is `connected`, so a disconnected account cannot
 * receive new events or be used for future actions.
 */
export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as { channel?: string; id?: string };
    if (
      (body.channel !== 'instagram' && body.channel !== 'facebook') ||
      !body.id
    ) {
      return NextResponse.json(
        { error: 'A connected Instagram or Facebook account is required' },
        { status: 400 }
      );
    }

    const { supabase, accountId } = await requireRole('admin');
    const { data, error } = await supabase
      .from('channel_accounts')
      .update({
        status: 'disconnected',
        access_token_encrypted: null,
        refresh_token_encrypted: null,
        token_expires_at: null,
      })
      .eq('id', body.id)
      .eq('account_id', accountId)
      .eq('channel', body.channel)
      .eq('status', 'connected')
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: 'Connected account not found' },
        { status: 404 }
      );
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
