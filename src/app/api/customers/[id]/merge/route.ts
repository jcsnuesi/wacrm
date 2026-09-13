import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { targetCustomerId?: string; reason?: string; score?: number };
    if (!body.targetCustomerId) {
      return NextResponse.json({ error: 'targetCustomerId is required' }, { status: 400 });
    }
    const { supabase } = await requireRole('agent');
    const { data, error } = await supabase.rpc('merge_customers', {
      source_customer: id,
      target_customer: body.targetCustomerId,
      merge_reason: body.reason?.trim() || null,
      merge_score: body.score ?? null,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ mergeId: data });
  } catch (error) {
    return toErrorResponse(error);
  }
}
