import { normalizePhone } from '@/lib/whatsapp/phone-utils';

export interface IdentityResolutionCandidate {
  customerId: string;
  phone?: string | null;
  email?: string | null;
}

export interface IdentityResolutionInput {
  externalIdentityCustomerId?: string | null;
  phone?: string | null;
  email?: string | null;
}

export type IdentityResolution =
  | { action: 'existing_identity'; customerId: string; method: 'external_id' }
  | { action: 'auto_match'; customerId: string; method: 'phone' | 'email' }
  | { action: 'new_customer' };

/**
 * The deterministic portion of Customer 360 resolution. It intentionally
 * never matches names or usernames: uncertain matches belong in a later
 * IdentityMatch review flow, never in an automatic merge.
 */
export function resolveIdentity(
  input: IdentityResolutionInput,
  candidates: IdentityResolutionCandidate[]
): IdentityResolution {
  if (input.externalIdentityCustomerId) {
    return {
      action: 'existing_identity',
      customerId: input.externalIdentityCustomerId,
      method: 'external_id',
    };
  }

  const phone = normalizePhone(input.phone ?? '');
  if (phone) {
    const match = candidates.find(
      (candidate) => normalizePhone(candidate.phone ?? '') === phone
    );
    if (match)
      return {
        action: 'auto_match',
        customerId: match.customerId,
        method: 'phone',
      };
  }

  const email = input.email?.trim().toLowerCase();
  if (email) {
    const match = candidates.find(
      (candidate) => candidate.email?.trim().toLowerCase() === email
    );
    if (match)
      return {
        action: 'auto_match',
        customerId: match.customerId,
        method: 'email',
      };
  }

  return { action: 'new_customer' };
}
