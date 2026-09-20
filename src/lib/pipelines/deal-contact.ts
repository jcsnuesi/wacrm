import type { Deal } from '@/types';

/**
 * Resolves the person label shown on a pipeline deal. Social conversations do
 * not create legacy contacts, so their canonical customer's channel identity
 * is the best fallback when the customer profile has no display name yet.
 */
export function getDealContactLabel(deal: Deal): string | null {
  const customerLabel = deal.customer?.display_name?.trim();
  if (customerLabel) return customerLabel;

  const sourceChannel = deal.source_channel?.trim().toLowerCase();
  const identities = deal.customer?.contact_identities ?? [];
  const identity =
    identities.find(
      (candidate) => candidate.channel?.trim().toLowerCase() === sourceChannel
    ) ?? identities[0];
  const identityLabel =
    identity?.display_name?.trim() ||
    identity?.username?.trim() ||
    identity?.phone?.trim();
  if (identityLabel) return identityLabel;

  return (
    deal.contact?.name?.trim() ||
    deal.customer?.phone ||
    deal.contact?.phone ||
    null
  );
}
