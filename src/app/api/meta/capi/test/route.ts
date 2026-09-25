import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { metaCapiAdmin } from '@/lib/meta/capi/admin-client';
import { sendMetaCapiEvent } from '@/lib/meta/capi/client';
import { decrypt } from '@/lib/whatsapp/encryption';

export async function POST() {
  try {
    const { accountId } = await requireRole('admin');
    const admin = metaCapiAdmin();
    const { data: connection } = await admin
      .from('meta_capi_connections')
      .select(
        'id, dataset_id, waba_id, graph_api_version, test_event_code, access_token_encrypted'
      )
      .eq('account_id', accountId)
      .eq('status', 'testing')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!connection?.access_token_encrypted || !connection.test_event_code) {
      return NextResponse.json(
        {
          error: 'Save a Testing connection, token, and test event code first',
        },
        { status: 400 }
      );
    }
    const { data: attribution } = await admin
      .from('meta_attributions')
      .select('ctwa_clid')
      .eq('account_id', accountId)
      .eq('waba_id', connection.waba_id)
      .order('attributed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!attribution) {
      return NextResponse.json(
        { error: 'No Click-to-WhatsApp attribution has been captured yet' },
        { status: 409 }
      );
    }

    const result = await sendMetaCapiEvent(
      {
        datasetId: connection.dataset_id,
        accessToken: decrypt(connection.access_token_encrypted),
        graphApiVersion: connection.graph_api_version,
        testEventCode: connection.test_event_code,
      },
      {
        data: [
          {
            event_name: 'LeadSubmitted',
            event_time: Math.floor(Date.now() / 1000),
            event_id: `wacrm-test:${randomUUID()}`,
            action_source: 'business_messaging',
            messaging_channel: 'whatsapp',
            user_data: {
              whatsapp_business_account_id: connection.waba_id,
              ctwa_clid: attribution.ctwa_clid,
            },
          },
        ],
      }
    );
    await admin
      .from('meta_capi_connections')
      .update(
        result.ok
          ? { last_verified_at: new Date().toISOString(), last_error: null }
          : {
              last_error: `Test failed with HTTP ${result.status || 'network'}`,
            }
      )
      .eq('id', connection.id);
    return NextResponse.json(
      result.ok
        ? { ok: true, response: result.body }
        : { error: 'Meta rejected the test event', details: result.body },
      { status: result.ok ? 200 : 502 }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
