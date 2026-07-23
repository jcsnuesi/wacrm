// ============================================================
// Server-side account context — for API routes and server
// components. Reads the caller's profile + account in one round
// trip and verifies role on demand.
//
// IMPORTANT: this module is server-only. It imports the Supabase
// SSR client (`@/lib/supabase/server`), which reads `next/headers`
// cookies. Importing it from a client component will fail at
// build time with the standard Next.js "You're importing a
// component that needs `next/headers`" error — that's the
// boundary check; we don't need the `server-only` package.
//
// Calling convention
// ------------------
// API routes don't need to redo `supabase.auth.getUser()` — they
// receive a fully-loaded context from `requireRole`:
//
//   try {
//     const ctx = await requireRole("admin");
//     // ctx.supabase — the SSR client (RLS scoped to this user)
//     // ctx.userId  — auth.uid()
//     // ctx.accountId / ctx.role / ctx.account
//   } catch (err) {
//     return errorResponse(err); // see toErrorResponse() below
//   }
// ============================================================

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

import { createClient } from '@/lib/supabase/server';
import { hasMinRole, isAccountRole, type AccountRole } from './roles';
import {
  ACTIVE_ACCOUNT_COOKIE,
  isActiveAccountSwitchEnabled,
  isUuid,
} from './active-account';

// ------------------------------------------------------------
// Errors
//
// Custom classes so API routes can map a single `catch` to the
// right HTTP status without sprinkling 401/403 strings everywhere.
// ------------------------------------------------------------

export class UnauthorizedError extends Error {
  readonly status = 401 as const;
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  readonly status = 403 as const;
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Convert one of the typed errors above (or anything else) into a
 * `NextResponse`. Routes can do:
 *
 *   } catch (err) {
 *     return toErrorResponse(err);
 *   }
 *
 * Unknown errors collapse to 500 with the generic message — we
 * never leak `err.message` for non-classified errors to keep
 * server internals out of the wire.
 */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error('[toErrorResponse] uncategorized error:', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

// ------------------------------------------------------------
// Account context
// ------------------------------------------------------------

export interface AccountContext {
  /** Supabase SSR client, RLS scoped to the calling user. */
  supabase: SupabaseClient;
  /** `auth.uid()` for the caller. Always defined when this resolves. */
  userId: string;
  /** Resolved account_id for this request context. */
  accountId: string;
  /** Caller's role within their account. */
  role: AccountRole;
  /** Lightweight account meta — id + name + default currency. */
  account: { id: string; name: string; default_currency: string };
}

/**
 * Resolve the caller's user + account + role in one round trip.
 *
 * Throws `UnauthorizedError` if there's no Supabase session.
 * Uses profile tenancy as the legacy-first source. If
 * `profiles.account_id/account_role` are missing, falls back to
 * canonical `account_members` membership so Stage 2 can proceed for
 * users already migrated to memberships.
 *
 * Use `requireRole(min)` instead when the route also needs a
 * minimum-role check — it's a thin wrapper over this.
 */
export async function getCurrentAccount(): Promise<AccountContext> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    throw new UnauthorizedError();
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    console.error('[getCurrentAccount] profile fetch error:', error);
    throw new ForbiddenError('Could not load account context');
  }
  const profileAccountId = data?.account_id ?? null;
  const profileRole = data?.account_role ?? null;

  let accountId: string | null = null;
  let role: AccountRole | null = null;

  if (profileAccountId && profileRole) {
    if (!isAccountRole(profileRole)) {
      // The DB enum should make this impossible, but a future
      // migration that broadens the enum without updating TS would
      // hit this — surface it rather than silently widening.
      throw new ForbiddenError(`Unknown account role: ${profileRole}`);
    }

    accountId = profileAccountId;
    role = profileRole;
  } else {
    // Transition fallback: when profile tenancy fields are missing,
    // resolve from canonical memberships. Pick a deterministic row so
    // requests are stable in multi-membership cases.
    const { data: membership, error: membershipError } = await supabase
      .from('account_members')
      .select('account_id, role, joined_at')
      .eq('user_id', user.id)
      .order('joined_at', { ascending: true })
      .order('account_id', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      console.error(
        '[getCurrentAccount] membership fallback fetch error:',
        membershipError
      );
      throw new ForbiddenError('Could not load account context');
    }

    if (membership?.account_id && isAccountRole(membership.role)) {
      accountId = membership.account_id;
      role = membership.role;
    }
  }

  if (!accountId || !role) {
    // No usable legacy profile linkage and no canonical membership.
    throw new ForbiddenError('Profile is not linked to an account');
  }

  if (!isAccountRole(role)) {
    // The DB enum should make this impossible, but a future
    // migration that broadens the enum without updating TS would
    // hit this — surface it rather than silently widening.
    throw new ForbiddenError(`Unknown account role: ${role}`);
  }

  // Session-level account override (active account switch). If the
  // cookie is absent/invalid/unauthorized we silently fall back to the
  // already-resolved base account (profile-first, membership fallback).
  if (isActiveAccountSwitchEnabled()) {
    try {
      const cookieStore = await cookies();
      const requested = cookieStore.get(ACTIVE_ACCOUNT_COOKIE)?.value ?? null;

      if (requested && requested !== accountId && isUuid(requested)) {
        const { data: membership, error: membershipError } = await supabase
          .from('account_members')
          .select('role')
          .eq('account_id', requested)
          .eq('user_id', user.id)
          .maybeSingle();

        if (membershipError) {
          // Pre-migration deployments may not have account_members yet.
          // Keep legacy behavior instead of failing account resolution.
          console.warn(
            '[getCurrentAccount] active-account membership lookup failed; using legacy profile account:',
            membershipError.message
          );
        } else if (membership && isAccountRole(membership.role)) {
          accountId = requested;
          role = membership.role;
        }
      }
    } catch (err) {
      console.warn(
        '[getCurrentAccount] active-account cookie read failed:',
        err
      );
    }
  }

  // Load the account with a plain point lookup by id rather than an
  // embedded FK join (`account:accounts!inner(...)`). The embed forces
  // PostgREST to resolve the profiles.account_id → accounts.id
  // relationship from its schema cache; when that cache is stale — a
  // common Supabase state right after a migration adds the FK, or when
  // migrations are applied out of band — the embed fails hard with
  // PGRST200 ("could not find a relationship … in the schema cache")
  // and takes down the entire account context (issue #294). A lookup by
  // id needs no relationship inference and is gated by the same accounts
  // RLS, so it stays robust against cache staleness and older schemas.
  const { data: account, error: accountErr } = await supabase
    .from('accounts')
    .select('id, name, default_currency')
    .eq('id', accountId)
    .maybeSingle();

  if (accountErr) {
    console.error('[getCurrentAccount] account fetch error:', accountErr);
    throw new ForbiddenError('Could not load account context');
  }
  if (!account) {
    // account_id points at no readable account row — orphaned profile
    // or an RLS gap. Same "can't scope this user" outcome as above.
    throw new ForbiddenError('Profile is not linked to an account');
  }

  return {
    supabase,
    userId: user.id,
    accountId,
    role,
    account: {
      id: account.id,
      name: account.name,
      default_currency: account.default_currency ?? 'USD',
    },
  };
}

/**
 * Resolve the caller's account context and enforce a minimum role.
 *
 * Throws `UnauthorizedError` / `ForbiddenError` as documented on
 * `getCurrentAccount`, plus `ForbiddenError("Insufficient role")`
 * when the caller is below `min`.
 */
export async function requireRole(min: AccountRole): Promise<AccountContext> {
  const ctx = await getCurrentAccount();
  if (!hasMinRole(ctx.role, min)) {
    throw new ForbiddenError(
      `This action requires the '${min}' role or higher`
    );
  }
  return ctx;
}
