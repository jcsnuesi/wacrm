import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { isUuid } from '@/lib/auth/active-account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent');
    const limit = checkRateLimit(
      `ai-pipeline-review:${userId}`,
      RATE_LIMITS.send
    );
    if (!limit.success) return rateLimitResponse(limit);
    const { id } = await params;
    if (!isUuid(id))
      return NextResponse.json({ error: 'Invalid event id' }, { status: 400 });
    const body = await request.json().catch(() => null);
    const action = body?.action;
    const dealId =
      typeof body?.deal_id === 'string' && isUuid(body.deal_id)
        ? body.deal_id
        : null;
    if (!['apply', 'dismiss', 'undo'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be apply, dismiss, or undo' },
        { status: 400 }
      );
    }
    const { data: event } = await supabase
      .from('ai_pipeline_routing_events')
      .select('id')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!event)
      return NextResponse.json(
        { error: 'Routing event not found' },
        { status: 404 }
      );

    const { data, error } = await supabase.rpc(
      'review_ai_pipeline_routing_event',
      {
        p_event_id: id,
        p_action: action,
        p_deal_id: dealId,
      }
    );
    if (error) {
      console.error('[ai/pipeline-routing/events POST] review failed', error);
      return NextResponse.json(
        { error: 'Failed to review routing event' },
        { status: 409 }
      );
    }
    return NextResponse.json({ success: true, result: data });
  } catch (error) {
    return toErrorResponse(error);
  }
}
