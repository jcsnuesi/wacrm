import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { encrypt } from '@/lib/whatsapp/encryption';
import { metaCapiAdmin } from '@/lib/meta/capi/admin-client';

const STATUS = new Set(['disabled', 'testing', 'active']);
const GRAPH_VERSION = /^v\d+\.\d+$/;

interface MappingInput {
  stage_id: string;
  event_name: string;
  include_value?: boolean;
  is_enabled?: boolean;
}

export async function GET() {
  try {
    const { accountId, supabase } = await requireRole('admin');
    const admin = metaCapiAdmin();
    const [
      connectionResult,
      configsResult,
      pipelinesResult,
      mappingsResult,
      statsResult,
    ] = await Promise.all([
      admin
        .from('meta_capi_connections')
        .select(
          'id, whatsapp_config_id, business_portfolio_id, ad_account_id, waba_id, dataset_id, graph_api_version, test_event_code, status, last_verified_at, last_error, access_token_encrypted'
        )
        .eq('account_id', accountId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('whatsapp_config')
        .select('id, waba_id, sender_phone, is_active')
        .eq('account_id', accountId),
      supabase
        .from('pipelines')
        .select('id, name, pipeline_stages(id, name, position)')
        .eq('account_id', accountId)
        .order('created_at'),
      supabase
        .from('meta_capi_stage_mappings')
        .select(
          'id, pipeline_id, stage_id, deal_status, event_name, include_value, is_enabled'
        )
        .eq('account_id', accountId),
      admin
        .from('meta_capi_outbox')
        .select('status')
        .eq('account_id', accountId),
    ]);
    for (const result of [
      connectionResult,
      configsResult,
      pipelinesResult,
      mappingsResult,
      statsResult,
    ]) {
      if (result.error) throw result.error;
    }
    const connection = connectionResult.data;
    const statuses = (statsResult.data ?? []) as { status: string }[];
    return NextResponse.json({
      connection: connection
        ? {
            ...connection,
            has_token: !!connection.access_token_encrypted,
            access_token_encrypted: undefined,
          }
        : null,
      whatsapp_configs: configsResult.data ?? [],
      pipelines: pipelinesResult.data ?? [],
      mappings: mappingsResult.data ?? [],
      delivery: statuses.reduce<Record<string, number>>((acc, row) => {
        acc[row.status] = (acc[row.status] ?? 0) + 1;
        return acc;
      }, {}),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const { accountId } = await requireRole('admin');
    const body = (await request.json()) as Record<string, unknown>;
    const wabaId = String(body.waba_id ?? '').trim();
    const datasetId = String(body.dataset_id ?? '').trim();
    const graphVersion = String(body.graph_api_version ?? 'v25.0').trim();
    const status = String(body.status ?? 'disabled');
    const testEventCode = String(body.test_event_code ?? '').trim();
    const whatsappConfigId = String(body.whatsapp_config_id ?? '').trim();
    if (
      !wabaId ||
      !datasetId ||
      !whatsappConfigId ||
      !STATUS.has(status) ||
      !GRAPH_VERSION.test(graphVersion)
    ) {
      return NextResponse.json(
        { error: 'Invalid CAPI configuration' },
        { status: 400 }
      );
    }

    const admin = metaCapiAdmin();
    const { data: whatsappConfig } = await admin
      .from('whatsapp_config')
      .select('id, waba_id')
      .eq('id', whatsappConfigId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!whatsappConfig)
      return NextResponse.json(
        { error: 'WhatsApp connection not found' },
        { status: 400 }
      );
    if (whatsappConfig.waba_id && whatsappConfig.waba_id !== wabaId) {
      return NextResponse.json(
        { error: 'WABA ID does not match the selected WhatsApp connection' },
        { status: 400 }
      );
    }

    const connectionId = typeof body.id === 'string' ? body.id : null;
    const token =
      typeof body.access_token === 'string' ? body.access_token.trim() : '';
    let hasSavedToken = false;
    if (connectionId) {
      const { data: current } = await admin
        .from('meta_capi_connections')
        .select('access_token_encrypted')
        .eq('id', connectionId)
        .eq('account_id', accountId)
        .maybeSingle();
      hasSavedToken = !!current?.access_token_encrypted;
    }
    if (status !== 'disabled' && !token && !hasSavedToken) {
      return NextResponse.json(
        { error: 'An access token is required before enabling CAPI' },
        { status: 400 }
      );
    }
    if (status === 'testing' && !testEventCode) {
      return NextResponse.json(
        { error: 'A test event code is required in Testing mode' },
        { status: 400 }
      );
    }
    const values: Record<string, unknown> = {
      account_id: accountId,
      whatsapp_config_id: whatsappConfigId,
      business_portfolio_id:
        String(body.business_portfolio_id ?? '').trim() || null,
      ad_account_id: String(body.ad_account_id ?? '').trim() || null,
      waba_id: wabaId,
      dataset_id: datasetId,
      graph_api_version: graphVersion,
      test_event_code: testEventCode || null,
      status,
      last_error: null,
    };
    if (token) values.access_token_encrypted = encrypt(token);

    const query = connectionId
      ? admin
          .from('meta_capi_connections')
          .update(values)
          .eq('id', connectionId)
          .eq('account_id', accountId)
      : admin.from('meta_capi_connections').insert(values);
    const { data: saved, error } = await query.select('id').single();
    if (error) throw error;

    if (Array.isArray(body.mappings)) {
      const mappings = (body.mappings as MappingInput[]).filter(
        (item) =>
          typeof item?.stage_id === 'string' &&
          typeof item?.event_name === 'string' &&
          item.event_name.trim()
      );
      for (const mapping of mappings) {
        const { data: stage } = await admin
          .from('pipeline_stages')
          .select('id, pipeline_id, pipelines!inner(account_id)')
          .eq('id', mapping.stage_id)
          .eq('pipelines.account_id', accountId)
          .maybeSingle();
        if (!stage) continue;
        const values = {
          account_id: accountId,
          pipeline_id: stage.pipeline_id,
          stage_id: mapping.stage_id,
          deal_status: null,
          event_name: mapping.event_name.trim(),
          include_value: !!mapping.include_value,
          is_enabled: mapping.is_enabled !== false,
        };
        const { data: existing } = await admin
          .from('meta_capi_stage_mappings')
          .select('id')
          .eq('account_id', accountId)
          .eq('stage_id', mapping.stage_id)
          .maybeSingle();
        if (existing) {
          await admin
            .from('meta_capi_stage_mappings')
            .update(values)
            .eq('id', existing.id);
        } else {
          await admin.from('meta_capi_stage_mappings').insert(values);
        }
      }
    }

    return NextResponse.json({ ok: true, id: saved.id });
  } catch (error) {
    return toErrorResponse(error);
  }
}
