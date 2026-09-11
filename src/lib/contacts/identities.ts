import type { SupabaseClient } from '@supabase/supabase-js';

import type { Channel } from '@/lib/channels/types';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';

export interface ContactIdentityInput {
  accountId: string;
  contactId: string;
  channel: Channel;
  externalId: string;
  username?: string | null;
  displayName?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  metadata?: Record<string, unknown>;
}

export type ContactIdentityWriteResult =
  | { status: 'created' | 'updated'; id: string }
  | { status: 'conflict'; contactId: string };

export interface WhatsAppIdentitySyncInput {
  accountId: string;
  contactId: string;
  phone?: string | null;
  whatsappUserId?: string | null;
  username?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  provider: 'meta' | 'twilio';
}

/**
 * Canonicalize only phone-shaped WhatsApp external identifiers. Stable IDs
 * from Meta and future providers are opaque and must be preserved verbatim.
 */
export function normalizeIdentityExternalId(
  channel: Channel,
  externalId: string,
  identityType?: 'phone' | 'bsuid'
): string {
  const trimmed = externalId.trim();
  return channel === 'whatsapp' && identityType === 'phone'
    ? normalizePhone(trimmed)
    : trimmed;
}

/**
 * Creates or enriches an identity only when it already belongs to the same
 * contact. A collision is surfaced to the caller instead of automatically
 * merging contacts or moving an identity between them.
 */
export async function upsertContactIdentity(
  db: SupabaseClient,
  input: ContactIdentityInput
): Promise<ContactIdentityWriteResult | null> {
  const externalId = input.externalId.trim();
  if (!externalId) return null;

  const { data: existing, error: findError } = await db
    .from('contact_identities')
    .select('id, contact_id')
    .eq('account_id', input.accountId)
    .eq('channel', input.channel)
    .eq('external_id', externalId)
    .maybeSingle();
  if (findError) throw findError;

  const row = {
    account_id: input.accountId,
    contact_id: input.contactId,
    channel: input.channel,
    external_id: externalId,
    username: input.username ?? null,
    display_name: input.displayName ?? null,
    phone: input.phone ?? null,
    avatar_url: input.avatarUrl ?? null,
    metadata: input.metadata ?? {},
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    if (existing.contact_id !== input.contactId) {
      return { status: 'conflict', contactId: existing.contact_id };
    }
    const { error: updateError } = await db
      .from('contact_identities')
      .update(row)
      .eq('id', existing.id)
      .eq('account_id', input.accountId);
    if (updateError) throw updateError;
    return { status: 'updated', id: existing.id };
  }

  const { data: created, error: insertError } = await db
    .from('contact_identities')
    .insert(row)
    .select('id')
    .single();
  if (!insertError && created) return { status: 'created', id: created.id };

  // Concurrent webhook deliveries may both miss the initial lookup. Resolve
  // the winner; never overwrite its contact relationship.
  if ((insertError as { code?: string } | null)?.code === '23505') {
    const { data: winner, error: winnerError } = await db
      .from('contact_identities')
      .select('id, contact_id')
      .eq('account_id', input.accountId)
      .eq('channel', input.channel)
      .eq('external_id', externalId)
      .maybeSingle();
    if (winnerError) throw winnerError;
    if (winner?.contact_id === input.contactId) {
      return { status: 'updated', id: winner.id };
    }
    if (winner) return { status: 'conflict', contactId: winner.contact_id };
  }

  throw insertError;
}

/**
 * Mirrors the established WhatsApp contact fields into generic identities.
 * This is intentionally one-way during the compatibility phase: legacy
 * WhatsApp reads remain unchanged until generic resolution is introduced.
 */
export async function syncWhatsAppContactIdentities(
  db: SupabaseClient,
  input: WhatsAppIdentitySyncInput
): Promise<ContactIdentityWriteResult[]> {
  const writes: Promise<ContactIdentityWriteResult | null>[] = [];
  if (input.phone) {
    const externalId = normalizeIdentityExternalId(
      'whatsapp',
      input.phone,
      'phone'
    );
    if (externalId) {
      writes.push(
        upsertContactIdentity(db, {
          accountId: input.accountId,
          contactId: input.contactId,
          channel: 'whatsapp',
          externalId,
          phone: input.phone,
          displayName: input.displayName,
          avatarUrl: input.avatarUrl,
          metadata: { identity_type: 'phone', provider: input.provider },
        })
      );
    }
  }
  if (input.whatsappUserId?.trim()) {
    writes.push(
      upsertContactIdentity(db, {
        accountId: input.accountId,
        contactId: input.contactId,
        channel: 'whatsapp',
        externalId: normalizeIdentityExternalId(
          'whatsapp',
          input.whatsappUserId,
          'bsuid'
        ),
        username: input.username,
        displayName: input.displayName,
        phone: input.phone,
        avatarUrl: input.avatarUrl,
        metadata: { identity_type: 'bsuid', provider: input.provider },
      })
    );
  }
  return (await Promise.all(writes)).filter(
    (result): result is ContactIdentityWriteResult => result !== null
  );
}
