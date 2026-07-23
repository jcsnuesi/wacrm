import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import {
  ACTIVE_ACCOUNT_COOKIE,
  isActiveAccountSwitchEnabled,
  isUuid,
} from '@/lib/auth/active-account';

/**
 * GET /api/account/active
 * Returns the currently resolved account context (already honoring the
 * active-account cookie if present and authorized).
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const switchEnabled = isActiveAccountSwitchEnabled();

    let availableAccounts: Array<{
      id: string;
      name: string;
      default_currency: string;
      role: string;
    }> = [
      {
        id: ctx.account.id,
        name: ctx.account.name,
        default_currency: ctx.account.default_currency,
        role: ctx.role,
      },
    ];

    // Canonical multi-account list. If migration 029 hasn't run yet,
    // keep returning just the current account for backward compatibility.
    const membershipsResult = switchEnabled
      ? await ctx.supabase
          .from('account_members')
          .select('account_id, role')
          .eq('user_id', ctx.userId)
      : { data: null, error: null };

    const { data: memberships, error: membershipError } = membershipsResult;

    if (!membershipError && memberships && memberships.length > 0) {
      const roleByAccount = new Map<string, string>();
      for (const row of memberships) {
        if (row.account_id && row.role) {
          roleByAccount.set(row.account_id, row.role);
        }
      }
      if (!roleByAccount.has(ctx.account.id)) {
        roleByAccount.set(ctx.account.id, ctx.role);
      }

      const accountIds = Array.from(roleByAccount.keys());
      const { data: accountRows, error: accountError } = await ctx.supabase
        .from('accounts')
        .select('id, name, default_currency')
        .in('id', accountIds);

      if (!accountError && accountRows) {
        availableAccounts = accountRows
          .map((row) => ({
            id: row.id,
            name: row.name,
            default_currency: row.default_currency ?? 'USD',
            role: roleByAccount.get(row.id) ?? 'viewer',
          }))
          .sort((a, b) => {
            if (a.id === ctx.account.id) return -1;
            if (b.id === ctx.account.id) return 1;
            return a.name.localeCompare(b.name);
          });
      }
    }

    return NextResponse.json({
      account: ctx.account,
      account_id: ctx.accountId,
      role: ctx.role,
      available_accounts: availableAccounts,
      account_switch_enabled: switchEnabled,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/account/active
 * Body: { account_id: string }
 *
 * Sets the active account cookie for the current browser session only
 * after verifying the caller is a member of that account.
 */
export async function POST(request: Request) {
  try {
    if (!isActiveAccountSwitchEnabled()) {
      return NextResponse.json(
        { error: 'Active account switching is disabled' },
        { status: 404 }
      );
    }

    const ctx = await getCurrentAccount();

    const body = (await request.json().catch(() => null)) as {
      account_id?: unknown;
    } | null;
    const requested =
      typeof body?.account_id === 'string' ? body.account_id.trim() : '';

    if (!requested || !isUuid(requested)) {
      return NextResponse.json(
        { error: "'account_id' must be a valid UUID" },
        { status: 400 }
      );
    }

    // If caller is already on this account, just refresh cookie.
    if (requested !== ctx.accountId) {
      const { data: membership, error } = await ctx.supabase
        .from('account_members')
        .select('role')
        .eq('account_id', requested)
        .eq('user_id', ctx.userId)
        .maybeSingle();

      if (error || !membership) {
        return NextResponse.json(
          { error: 'You are not a member of this account' },
          { status: 403 }
        );
      }
    }

    const response = NextResponse.json({
      success: true,
      account_id: requested,
    });
    response.cookies.set(ACTIVE_ACCOUNT_COOKIE, requested, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE /api/account/active
 * Clears account override cookie; the app falls back to legacy
 * profile.account_id resolution.
 */
export async function DELETE() {
  try {
    if (!isActiveAccountSwitchEnabled()) {
      return NextResponse.json(
        { error: 'Active account switching is disabled' },
        { status: 404 }
      );
    }

    // Ensure caller is authenticated before mutating session context.
    await getCurrentAccount();

    const response = NextResponse.json({ success: true });
    response.cookies.delete(ACTIVE_ACCOUNT_COOKIE);
    return response;
  } catch (err) {
    return toErrorResponse(err);
  }
}
