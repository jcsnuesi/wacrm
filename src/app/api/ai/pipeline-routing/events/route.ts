import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { isUuid } from '@/lib/auth/active-account';

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const conversationId =
      new URL(request.url).searchParams.get('conversation_id') ?? '';
    if (!isUuid(conversationId)) {
      return NextResponse.json(
        { error: 'Valid conversation_id is required' },
        { status: 400 }
      );
    }
    const { data: conversation } = await supabase
      .from('conversations')
      .select('id, contact_id')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!conversation)
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      );

    const { data: events, error } = await supabase
      .from('ai_pipeline_routing_events')
      .select('*')
      .eq('account_id', accountId)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) {
      console.error('[ai/pipeline-routing/events GET] failed', error);
      return NextResponse.json(
        { error: 'Failed to load routing events' },
        { status: 500 }
      );
    }

    const rows = events ?? [];
    const stageIds = Array.from(
      new Set(
        rows
          .flatMap((event) => [
            event.previous_stage_id,
            event.proposed_stage_id,
            event.applied_stage_id,
          ])
          .filter(Boolean)
      )
    );
    const pipelineIds = Array.from(
      new Set(rows.map((event) => event.pipeline_id))
    );
    const [{ data: stages }, { data: deals }] = await Promise.all([
      stageIds.length
        ? supabase
            .from('pipeline_stages')
            .select('id, name, position')
            .in('id', stageIds)
        : Promise.resolve({ data: [] }),
      pipelineIds.length
        ? supabase
            .from('deals')
            .select('id, title, pipeline_id, stage_id, status')
            .eq('account_id', accountId)
            .eq('contact_id', conversation.contact_id)
            .eq('status', 'open')
            .in('pipeline_id', pipelineIds)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [] }),
    ]);
    const stageMap = Object.fromEntries(
      (stages ?? []).map((stage) => [stage.id, stage])
    );
    return NextResponse.json({
      events: rows,
      stages: stageMap,
      eligible_deals: deals ?? [],
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
