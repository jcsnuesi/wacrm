import type { SupabaseClient } from '@supabase/supabase-js';

interface MetaReferralPayload {
  ctwa_clid?: unknown;
  source_id?: unknown;
  source_type?: unknown;
  source_url?: unknown;
  headline?: unknown;
  body?: unknown;
  media_type?: unknown;
}

export interface ClickToWhatsAppReferral {
  ctwaClid: string;
  sourceId: string | null;
  sourceType: string | null;
  sourceUrl: string | null;
  creative: {
    headline?: string;
    body?: string;
    media_type?: string;
  };
}

export interface CaptureClickToWhatsAppAttributionInput {
  accountId: string;
  customerId: string;
  conversationId: string;
  whatsappConfigId: string;
  externalMessageId: string;
  wabaId: string | null;
  attributedAt: string;
  referral: ClickToWhatsAppReferral;
}

function nonBlankString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/**
 * Extract only the ad-attribution fields needed downstream. The full
 * provider payload can contain customer content, so it is deliberately not
 * copied into attribution metadata.
 */
export function parseClickToWhatsAppReferral(
  value: unknown
): ClickToWhatsAppReferral | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const referral = value as MetaReferralPayload;
  const ctwaClid = nonBlankString(referral.ctwa_clid);
  if (!ctwaClid) return null;

  const creative: ClickToWhatsAppReferral['creative'] = {};
  const headline = nonBlankString(referral.headline);
  const body = nonBlankString(referral.body);
  const mediaType = nonBlankString(referral.media_type);
  if (headline) creative.headline = headline;
  if (body) creative.body = body;
  if (mediaType) creative.media_type = mediaType;

  return {
    ctwaClid,
    sourceId: nonBlankString(referral.source_id),
    sourceType: nonBlankString(referral.source_type),
    sourceUrl: nonBlankString(referral.source_url),
    creative,
  };
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

/**
 * Store the first observed owner of a Meta click. Duplicate webhook
 * deliveries are successful no-ops; a click is never reassigned to another
 * customer or conversation.
 */
export async function captureClickToWhatsAppAttribution(
  db: SupabaseClient,
  input: CaptureClickToWhatsAppAttributionInput
): Promise<'captured' | 'duplicate'> {
  const { error } = await db.from('meta_attributions').insert({
    account_id: input.accountId,
    customer_id: input.customerId,
    conversation_id: input.conversationId,
    whatsapp_config_id: input.whatsappConfigId,
    source_type: 'click_to_whatsapp',
    ctwa_clid: input.referral.ctwaClid,
    external_message_id: input.externalMessageId,
    waba_id: input.wabaId,
    source_id: input.referral.sourceId,
    source_url: input.referral.sourceUrl,
    referral_source_type: input.referral.sourceType,
    attributed_at: input.attributedAt,
    metadata: input.referral.creative,
  });

  if (!error) return 'captured';
  if (isUniqueViolation(error)) return 'duplicate';
  throw new Error(`Failed to capture Meta attribution: ${error.message}`);
}
