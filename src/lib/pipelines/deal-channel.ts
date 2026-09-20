import type { Deal } from '@/types';

export const PIPELINE_CHANNELS = ['whatsapp', 'instagram', 'facebook'] as const;

export type PipelineChannel = (typeof PIPELINE_CHANNELS)[number];
export type PipelineChannelFilter = PipelineChannel | 'all';

export function getDealChannel(deal: Deal): PipelineChannel {
  const channel = deal.source_channel?.trim().toLowerCase();
  return PIPELINE_CHANNELS.includes(channel as PipelineChannel)
    ? (channel as PipelineChannel)
    : 'whatsapp';
}

export function getChannelCustomerCounts(deals: Deal[]) {
  const customerIds = new Map<PipelineChannel, Set<string>>(
    PIPELINE_CHANNELS.map((channel) => [channel, new Set<string>()])
  );

  for (const deal of deals) {
    const channel = getDealChannel(deal);
    // A canonical customer is shared across social channels; prefixing the
    // source keeps legacy contacts and deals without an owner unambiguous.
    const customerId = deal.customer_id
      ? `customer:${deal.customer_id}`
      : deal.contact_id
        ? `contact:${deal.contact_id}`
        : `deal:${deal.id}`;
    customerIds.get(channel)?.add(customerId);
  }

  return PIPELINE_CHANNELS.map((channel) => ({
    channel,
    count: customerIds.get(channel)?.size ?? 0,
  }));
}
