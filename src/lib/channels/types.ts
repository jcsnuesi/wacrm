export const CHANNELS = ['whatsapp', 'instagram', 'facebook', 'tiktok'] as const;

export type Channel = (typeof CHANNELS)[number];

export function isChannel(value: unknown): value is Channel {
  return typeof value === 'string' && (CHANNELS as readonly string[]).includes(value);
}
