import { MessageCircle } from 'lucide-react';

import type { Conversation } from '@/types';
import { cn } from '@/lib/utils';

export type InboxChannel = 'whatsapp' | 'instagram' | 'facebook' | 'unknown';

const CHANNEL_DETAILS = {
  whatsapp: { label: 'WhatsApp', icon: MessageCircle, className: 'text-emerald-500' },
  instagram: { label: 'Instagram', icon: InstagramIcon, className: 'text-fuchsia-500' },
  facebook: { label: 'Facebook', icon: FacebookIcon, className: 'text-blue-500' },
  unknown: { label: 'Messaging', icon: MessageCircle, className: 'text-muted-foreground' },
} as const;

export function getInboxChannel(conversation: Conversation): InboxChannel {
  const channel = conversation.channel_account?.channel?.toLowerCase();
  if (channel === 'instagram' || channel === 'facebook' || channel === 'whatsapp') {
    return channel;
  }
  if (conversation.contact?.source_channel === 'instagram' || conversation.contact?.source_channel === 'facebook') {
    return conversation.contact.source_channel;
  }
  return conversation.whatsapp_config ? 'whatsapp' : 'unknown';
}

export function getInboxChannelLabel(channel: InboxChannel): string {
  return CHANNEL_DETAILS[channel].label;
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M13.6 21v-8h2.7l.4-3h-3.1V8.1c0-.9.3-1.5 1.6-1.5h1.7V3.9c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3V10H7.5v3h2.7v8h3.4Z" />
    </svg>
  );
}

export function ChannelIndicator({
  channel,
  className,
  withLabel = false,
}: {
  channel: InboxChannel;
  className?: string;
  withLabel?: boolean;
}) {
  const { icon: Icon, label, className: iconClassName } = CHANNEL_DETAILS[channel];

  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-1', iconClassName, className)}
      title={label}
    >
      <Icon aria-label={label} className="size-3.5" />
      {withLabel ? <span className="text-[10px] font-medium">{label}</span> : null}
    </span>
  );
}
