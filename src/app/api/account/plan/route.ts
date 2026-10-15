import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { readAccountPlan } from '@/lib/billing/account-plan';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const access = await readAccountPlan(ctx.supabase, ctx.accountId);
    return NextResponse.json(
      { data: access },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
