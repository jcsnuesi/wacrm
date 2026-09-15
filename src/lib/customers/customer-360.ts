import type {
  Customer360Conversation,
  Customer360Identity,
  Customer360Summary,
} from './customer-360-types';

export function getCustomerDisplayName(customer: Customer360Summary): string {
  return (
    customer.display_name?.trim() ||
    [customer.first_name?.trim(), customer.last_name?.trim()]
      .filter(Boolean)
      .join(' ') ||
    'Sin nombre'
  );
}

export function getIdentityDisplayLabel(identity: Customer360Identity): string {
  const username = identity.username?.trim();
  if (username) return username.startsWith('@') ? username : `@${username}`;
  return identity.display_name?.trim() || identity.external_id;
}

export function sortCustomerConversations(
  conversations: Customer360Conversation[]
): Customer360Conversation[] {
  return [...conversations].sort((a, b) => {
    if (!a.last_message_at) return b.last_message_at ? 1 : 0;
    if (!b.last_message_at) return -1;
    return (
      new Date(b.last_message_at).getTime() -
      new Date(a.last_message_at).getTime()
    );
  });
}
