import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import {
  registerPhoneNumber,
  subscribeWabaToApp,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api';
import { encrypt, decrypt } from '@/lib/whatsapp/encryption';

/**
 * Resolve the caller's account_id from their profile. Inlined here
 * (rather than going through `@/lib/auth/account.getCurrentAccount`)
 * because the GET handler wants to return shaped 200s for every
 * non-auth failure mode, not throw — keeping the helper minimal lets
 * the existing response branches stay as-is.
 *
 * Returns null if the user has no profile or no account; callers
 * should treat that the same as "not connected".
 */
async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data?.account_id) return null;
  return data.account_id as string;
}

interface WhatsAppConfigRow {
  id: string;
  account_id: string;
  user_id: string;
  phone_number_id: string;
  waba_id: string | null;
  access_token: string;
  verify_token: string | null;
  status: 'connected' | 'disconnected';
  connected_at: string | null;
  registered_at: string | null;
  subscribed_apps_at: string | null;
  last_registration_error: string | null;
  updated_at: string | null;
  created_at: string | null;
  is_active: boolean | null;
}

function isMissingIsActiveColumn(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: string }).code;
  const message = String((error as { message?: string }).message ?? '');
  return code === '42703' && message.includes('is_active');
}

let _supportsIsActiveColumn: boolean | null = null;

async function supportsIsActiveColumn(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<boolean> {
  if (_supportsIsActiveColumn != null) return _supportsIsActiveColumn;

  const { error } = await supabase
    .from('whatsapp_config')
    .select('is_active')
    .limit(1);

  if (isMissingIsActiveColumn(error)) {
    _supportsIsActiveColumn = false;
    return false;
  }

  _supportsIsActiveColumn = true;
  return true;
}

async function getAccountConfigs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
  supportsActiveColumn: boolean
): Promise<WhatsAppConfigRow[]> {
  const baseQuery = supabase
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .order('updated_at', { ascending: false })
    .order('created_at', { ascending: false });

  const { data, error } = supportsActiveColumn
    ? await baseQuery.order('is_active', { ascending: false })
    : await baseQuery;

  if (error) {
    throw error;
  }

  return (data ?? []) as WhatsAppConfigRow[];
}

async function ensureSingleActiveConfig(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
  supportsActiveColumn: boolean
): Promise<void> {
  if (!supportsActiveColumn) return;

  const configs = await getAccountConfigs(supabase, accountId, true);
  if (configs.length === 0) return;
  if (configs.some((cfg) => cfg.is_active)) return;

  const fallback = configs[0];
  await supabase
    .from('whatsapp_config')
    .update({ is_active: true, updated_at: new Date().toISOString() })
    .eq('id', fallback.id);
}

// Lazy-initialised service-role client. We need it to detect a
// phone_number_id already claimed by a *different* user — under RLS,
// the user's own session can't see other users' rows, so the conflict
// would be invisible without the service role.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _adminClient;
}

/**
 * GET /api/whatsapp/config
 *
 * Used by the "Test API Connection" button and by the page to check
 * whether the saved config is healthy. Returns 200 in all non-auth cases
 * so the UI can render an appropriate message rather than show a 500.
 *
 * Response shape:
 *   { connected: true,  phone_info: {...} }
 *   { connected: false, reason: 'no_config',        message: '...' }
 *   { connected: false, reason: 'token_corrupted',  message: '...', needs_reset: true }
 *   { connected: false, reason: 'meta_api_error',   message: '...' }
 */
export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const accountId = await resolveAccountId(supabase, user.id);
    if (!accountId) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_account',
          message: 'Your profile is not linked to an account.',
        },
        { status: 200 }
      );
    }

    const supportsActiveColumn = await supportsIsActiveColumn(supabase);

    await ensureSingleActiveConfig(supabase, accountId, supportsActiveColumn);

    const activeQuery = supabase
      .from('whatsapp_config')
      .select(
        supportsActiveColumn
          ? 'id, phone_number_id, access_token, status, is_active'
          : 'id, phone_number_id, access_token, status'
      )
      .eq('account_id', accountId);

    const { data: config, error: configError } = supportsActiveColumn
      ? await activeQuery.eq('is_active', true).maybeSingle()
      : await activeQuery.maybeSingle();

    if (configError) {
      console.error('Error fetching whatsapp_config:', configError);
      return NextResponse.json(
        {
          connected: false,
          reason: 'db_error',
          message: 'Failed to fetch configuration',
        },
        { status: 200 }
      );
    }

    const configs = await getAccountConfigs(
      supabase,
      accountId,
      supportsActiveColumn
    );

    if (!config) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_config',
          message:
            'No WhatsApp configuration saved yet. Fill in the form and click Save Configuration.',
          configs: [],
        },
        { status: 200 }
      );
    }

    // Try to decrypt the stored token with the current ENCRYPTION_KEY.
    // If this fails, the key changed (or was never consistent across envs).
    let accessToken: string;
    try {
      accessToken = decrypt(config.access_token);
    } catch (err) {
      console.error('[whatsapp/config GET] Token decryption failed:', err);
      return NextResponse.json(
        {
          connected: false,
          reason: 'token_corrupted',
          needs_reset: true,
          message:
            'The stored access token cannot be decrypted with the current ENCRYPTION_KEY. This usually means the key changed, or it differs between environments (local vs Hostinger vs Vercel). Click "Reset Configuration" below, then re-save.',
          active_config_id: config.id,
          configs: configs.map((row) => ({
            id: row.id,
            phone_number_id: row.phone_number_id,
            waba_id: row.waba_id,
            status: row.status,
            connected_at: row.connected_at,
            is_active: supportsActiveColumn ? !!row.is_active : true,
            updated_at: row.updated_at,
          })),
        },
        { status: 200 }
      );
    }

    // Validate credentials against Meta
    try {
      const phoneInfo = await verifyPhoneNumber({
        phoneNumberId: config.phone_number_id,
        accessToken,
      });
      return NextResponse.json({
        connected: true,
        phone_info: phoneInfo,
        active_config_id: config.id,
        configs: configs.map((row) => ({
          id: row.id,
          phone_number_id: row.phone_number_id,
          waba_id: row.waba_id,
          status: row.status,
          connected_at: row.connected_at,
          is_active: supportsActiveColumn ? !!row.is_active : true,
          updated_at: row.updated_at,
        })),
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown Meta API error';
      console.error(
        '[whatsapp/config GET] Meta API verification failed:',
        message
      );
      return NextResponse.json(
        {
          connected: false,
          reason: 'meta_api_error',
          message: `Meta API rejected the credentials: ${message}`,
          active_config_id: config.id,
          configs: configs.map((row) => ({
            id: row.id,
            phone_number_id: row.phone_number_id,
            waba_id: row.waba_id,
            status: row.status,
            connected_at: row.connected_at,
            is_active: supportsActiveColumn ? !!row.is_active : true,
            updated_at: row.updated_at,
          })),
        },
        { status: 200 }
      );
    }
  } catch (error) {
    console.error('Error in WhatsApp config GET:', error);
    return NextResponse.json(
      { connected: false, reason: 'unknown', message: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/whatsapp/config
 *
 * Saves or updates the WhatsApp config for the authenticated user.
 * Verifies credentials with Meta first, then encrypts and stores.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const accountId = await resolveAccountId(supabase, user.id);
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 }
      );
    }

    const supportsActiveColumn = await supportsIsActiveColumn(supabase);

    const body = await request.json();
    const {
      phone_number_id,
      waba_id,
      access_token,
      verify_token,
      pin,
      config_id,
      mode,
      activate,
    } = body;

    const createMode = mode === 'create' || config_id === 'new';
    const activateMode = mode === 'activate';

    if (activateMode) {
      if (!supportsActiveColumn) {
        return NextResponse.json(
          {
            error:
              'Switching between WhatsApp lines requires migration 031_whatsapp_config_multi_line_active.sql.',
          },
          { status: 409 }
        );
      }

      if (typeof config_id !== 'string' || !config_id || config_id === 'new') {
        return NextResponse.json(
          { error: 'config_id is required to activate a WhatsApp line.' },
          { status: 400 }
        );
      }

      const { data: target, error: targetError } = await supabase
        .from('whatsapp_config')
        .select('id')
        .eq('id', config_id)
        .eq('account_id', accountId)
        .maybeSingle();

      if (targetError) {
        console.error('Error validating target config:', targetError);
        return NextResponse.json(
          { error: 'Failed to validate target configuration' },
          { status: 500 }
        );
      }

      if (!target) {
        return NextResponse.json(
          {
            error:
              'Selected WhatsApp configuration does not exist in this account.',
          },
          { status: 404 }
        );
      }

      const { error: clearActiveError } = await supabase
        .from('whatsapp_config')
        .update({ is_active: false })
        .eq('account_id', accountId);

      if (clearActiveError) {
        console.error('Error clearing active WhatsApp line:', clearActiveError);
        return NextResponse.json(
          { error: 'Failed to switch active WhatsApp line' },
          { status: 500 }
        );
      }

      const { error: setActiveError } = await supabase
        .from('whatsapp_config')
        .update({ is_active: true, updated_at: new Date().toISOString() })
        .eq('id', config_id);

      if (setActiveError) {
        console.error('Error activating WhatsApp line:', setActiveError);
        return NextResponse.json(
          { error: 'Failed to switch active WhatsApp line' },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true, active_config_id: config_id });
    }

    if (
      typeof config_id === 'string' &&
      config_id &&
      config_id !== 'new' &&
      !createMode
    ) {
      const { data: ownedConfig, error: ownedConfigError } = await supabase
        .from('whatsapp_config')
        .select('id')
        .eq('id', config_id)
        .eq('account_id', accountId)
        .maybeSingle();

      if (ownedConfigError) {
        console.error('Error validating config ownership:', ownedConfigError);
        return NextResponse.json(
          { error: 'Failed to validate target configuration' },
          { status: 500 }
        );
      }

      if (!ownedConfig) {
        return NextResponse.json(
          {
            error:
              'Selected WhatsApp configuration does not exist in this account.',
          },
          { status: 404 }
        );
      }
    }

    if (createMode && !supportsActiveColumn) {
      return NextResponse.json(
        {
          error:
            'Adding multiple WhatsApp lines requires migration 031_whatsapp_config_multi_line_active.sql.',
        },
        { status: 409 }
      );
    }

    if (!access_token || !phone_number_id) {
      return NextResponse.json(
        { error: 'access_token and phone_number_id are required' },
        { status: 400 }
      );
    }

    if (pin !== undefined && pin !== null && pin !== '') {
      if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
        return NextResponse.json(
          { error: 'PIN must be exactly 6 digits.' },
          { status: 400 }
        );
      }
    }

    // Reject if another account has already claimed this phone_number_id.
    // wacrm is single-tenant-per-WhatsApp-number — letting two accounts
    // bind the same number causes the webhook's `.single()` lookup to
    // throw PGRST116 ("multiple rows"), silently dropping every
    // inbound message. See issue #136. Post-multi-user we key on
    // account_id (not user_id) since teammates inside the same account
    // all share one config; the conflict is between accounts.
    const { data: claimed, error: claimedError } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('account_id')
      .eq('phone_number_id', phone_number_id)
      .neq('account_id', accountId)
      .maybeSingle();

    if (claimedError) {
      console.error('Error checking phone_number_id ownership:', claimedError);
      return NextResponse.json(
        { error: 'Failed to validate configuration' },
        { status: 500 }
      );
    }

    if (claimed) {
      return NextResponse.json(
        {
          error:
            'This WhatsApp phone number is already linked to another account on this instance. Each phone number can only be connected to one wacrm user.',
        },
        { status: 409 }
      );
    }

    // Verify credentials with Meta BEFORE saving
    let phoneInfo;
    try {
      phoneInfo = await verifyPhoneNumber({
        phoneNumberId: phone_number_id,
        accessToken: access_token,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown Meta API error';
      console.error('Meta API verification failed during save:', message);
      return NextResponse.json(
        { error: `Meta API error: ${message}` },
        { status: 400 }
      );
    }

    // Encrypt sensitive tokens before storing
    let encryptedAccessToken: string;
    let encryptedVerifyToken: string | null;
    try {
      encryptedAccessToken = encrypt(access_token);
      encryptedVerifyToken = verify_token ? encrypt(verify_token) : null;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown encryption error';
      console.error('Encryption failed:', message);
      return NextResponse.json(
        {
          error:
            'Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string in your environment variables.',
        },
        { status: 500 }
      );
    }

    // Look up any pre-existing row for this account so we know whether
    // this number is already registered with Meta — if so we can skip
    // /register when the user didn't provide a PIN this time around.
    const existingBaseQuery = supabase
      .from('whatsapp_config')
      .select(
        supportsActiveColumn
          ? 'id, registered_at, phone_number_id, is_active'
          : 'id, registered_at, phone_number_id'
      )
      .eq('account_id', accountId);

    const { data: existing, error: existingError } = await (createMode
      ? existingBaseQuery.eq('phone_number_id', phone_number_id).maybeSingle()
      : typeof config_id === 'string' && config_id && config_id !== 'new'
        ? existingBaseQuery.eq('id', config_id).maybeSingle()
        : supportsActiveColumn
          ? existingBaseQuery.eq('is_active', true).maybeSingle()
          : existingBaseQuery.maybeSingle());

    if (existingError) {
      console.error('Error loading existing whatsapp_config:', existingError);
      return NextResponse.json(
        { error: 'Failed to load current configuration' },
        { status: 500 }
      );
    }

    const sameNumber =
      existing?.phone_number_id === phone_number_id &&
      existing?.registered_at != null;

    // Step 1: register the phone number for inbound webhooks.
    //
    // Attempted on first save AND whenever the user supplies a fresh
    // PIN (e.g. they rotated the 2FA PIN in Meta Manager). Skipped
    // when the same number is already registered and no PIN was
    // supplied — re-registering an already-active number with a
    // stale PIN would actually fail and undo the active subscription.
    let registeredAt: string | null = existing?.registered_at ?? null;
    let registrationError: string | null = null;
    // True when registration was deliberately skipped because no PIN
    // was supplied (see below). Distinct from registrationError — this
    // is not a failure, just an incomplete-but-valid save.
    let registrationSkipped = false;

    const needsRegistration =
      !sameNumber || (typeof pin === 'string' && pin.length > 0);
    if (needsRegistration) {
      if (!pin) {
        // No PIN provided. Meta TEST numbers (Developer Console) are
        // pre-registered by Meta and expose no two-step verification
        // PIN to set, so requiring one made them impossible to connect
        // (issue #242). The /register + PIN step only matters for
        // production numbers under a shared WABA (issue #136), so treat
        // it as best-effort: skip it, save the (already Meta-verified)
        // credentials as connected, and leave registered_at null. The
        // UI surfaces a separate "Not registered" banner with a path to
        // add a PIN later for users who do need inbound webhook routing.
        registrationSkipped = true;
      } else {
        try {
          await registerPhoneNumber({
            phoneNumberId: phone_number_id,
            accessToken: access_token,
            pin,
          });
          registeredAt = new Date().toISOString();
        } catch (err) {
          registrationError =
            err instanceof Error ? err.message : 'Unknown Meta API error';
          console.error('Phone number /register failed:', registrationError);
          // We deliberately fall through and still save the row so the
          // user can retry without re-entering everything. The UI
          // surfaces `last_registration_error` so they see WHY it's
          // not actually live yet.
        }
      }
    }

    // Step 2: subscribe the WABA to this app. Idempotent on Meta's
    // side, so we call on every save and persist the timestamp.
    // Skipped only when there's no waba_id (legacy rows from before
    // we required it).
    let subscribedAppsAt: string | null = null;
    if (waba_id) {
      try {
        await subscribeWabaToApp({
          wabaId: waba_id,
          accessToken: access_token,
        });
        subscribedAppsAt = new Date().toISOString();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn('WABA subscribed_apps failed (non-fatal):', message);
        // Subscription failures are rare once the App has the right
        // permissions; we don't block save on them — the diagnostic
        // endpoint surfaces this state too.
      }
    }

    // Persist everything in one shot. If /register failed we still
    // store the credentials and the error so the UI can guide the
    // user through a retry.
    const baseRow = {
      phone_number_id,
      waba_id: waba_id || null,
      access_token: encryptedAccessToken,
      verify_token: encryptedVerifyToken,
      status: registrationError ? 'disconnected' : 'connected',
      connected_at: registrationError ? null : new Date().toISOString(),
      registered_at: registrationError ? null : registeredAt,
      subscribed_apps_at: subscribedAppsAt ?? null,
      last_registration_error: registrationError,
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      if (activate === true && supportsActiveColumn) {
        await supabase
          .from('whatsapp_config')
          .update({ is_active: false })
          .eq('account_id', accountId);
      }

      const { error: updateError } = await supabase
        .from('whatsapp_config')
        .update({
          ...baseRow,
          ...(supportsActiveColumn
            ? {
                is_active:
                  activate === true ? true : (existing.is_active ?? true),
              }
            : {}),
        })
        .eq('id', existing.id);

      if (updateError) {
        console.error('Error updating whatsapp_config:', updateError);
        return NextResponse.json(
          { error: 'Failed to update configuration' },
          { status: 500 }
        );
      }
    } else {
      // Insert with both columns: `account_id` is the tenancy key
      // and `user_id` is the audit column identifying which member
      // of the account saved the config.
      if (supportsActiveColumn && (activate === true || createMode)) {
        await supabase
          .from('whatsapp_config')
          .update({ is_active: false })
          .eq('account_id', accountId);
      }

      const { error: insertError } = await supabase
        .from('whatsapp_config')
        .insert({
          account_id: accountId,
          user_id: user.id,
          ...(supportsActiveColumn
            ? { is_active: activate === false ? false : true }
            : {}),
          ...baseRow,
        });

      if (insertError) {
        console.error('Error inserting whatsapp_config:', insertError);
        return NextResponse.json(
          { error: 'Failed to save configuration' },
          { status: 500 }
        );
      }
    }

    await ensureSingleActiveConfig(supabase, accountId, supportsActiveColumn);

    if (registrationError) {
      // Save succeeded but the number isn't actually live. Return
      // 200 with a structured error so the UI can show the specific
      // remediation step instead of a generic toast.
      return NextResponse.json({
        success: false,
        saved: true,
        registered: false,
        registration_error: registrationError,
        phone_info: phoneInfo,
      });
    }

    return NextResponse.json({
      success: true,
      saved: true,
      registered: registeredAt != null,
      // Credentials are valid and saved, but inbound webhook
      // registration was skipped because no PIN was supplied (e.g. a
      // Meta test number). The UI shows the "Not registered" banner
      // rather than claiming the number is fully live.
      registration_skipped: registrationSkipped,
      phone_info: phoneInfo,
    });
  } catch (error) {
    console.error('Error in WhatsApp config POST:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/whatsapp/config
 *
 * Removes the authenticated user's WhatsApp configuration row.
 * Used by the "Reset Configuration" button to recover from a corrupted
 * encrypted token (mismatched ENCRYPTION_KEY across environments).
 */
export async function DELETE(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const accountId = await resolveAccountId(supabase, user.id);
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 }
      );
    }

    const supportsActiveColumn = await supportsIsActiveColumn(supabase);

    const { searchParams } = new URL(request.url);
    const targetConfigId = searchParams.get('config_id');

    const deleteQuery = supabase
      .from('whatsapp_config')
      .delete()
      .eq('account_id', accountId);

    const { error: deleteError } = await (targetConfigId
      ? deleteQuery.eq('id', targetConfigId)
      : supportsActiveColumn
        ? deleteQuery.eq('is_active', true)
        : deleteQuery);

    if (deleteError) {
      console.error('Error deleting whatsapp_config:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete configuration' },
        { status: 500 }
      );
    }

    await ensureSingleActiveConfig(supabase, accountId, supportsActiveColumn);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in WhatsApp config DELETE:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
