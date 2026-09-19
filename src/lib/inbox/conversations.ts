import type { Conversation, Contact, Tag } from '@/types';

/** Build the Inbox deep-link that opens a specific conversation. */
export function getConversationHref(conversationId: string): string {
  return `/inbox?c=${encodeURIComponent(conversationId)}`;
}

/**
 * Conversation select that embeds the contact plus its tags, so the Inbox
 * can filter conversations by contact tag without a second round-trip.
 * `contact_tags(tags(*))` returns the join rows; {@link normalizeConversation}
 * flattens them onto `contact.tags`.
 */
export const CONVERSATION_SELECT =
  '*, contact:contacts(*, contact_tags(tags(*))), customer:customers(id, account_id, display_name, first_name, last_name, email, phone, created_at, updated_at), customer_identity:contact_identities(id, channel, external_id, username, display_name, phone, profile_picture_url), channel_account:channel_accounts(channel, display_name, username), whatsapp_config:whatsapp_config(id, provider, phone_number_id, sender_phone, status)';

/** Raw shape returned by {@link CONVERSATION_SELECT} before flattening. */
type RawContact = Contact & { contact_tags?: { tags: Tag | null }[] };
type RawCustomer = {
  id: string;
  account_id: string;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  created_at: string;
  updated_at: string;
};
type RawCustomerIdentity = {
  channel?: Contact['source_channel'];
  external_id: string;
  username?: string | null;
  display_name?: string | null;
  phone?: string | null;
  profile_picture_url?: string | null;
};
type RawConversation = Omit<Conversation, 'contact' | 'contact_id'> & {
  // Canonical social conversations do not have a legacy contacts row.
  contact_id?: string | null;
  contact?: RawContact | null;
  customer?: RawCustomer | null;
  customer_identity?: RawCustomerIdentity | null;
};

function customerAsInboxContact(
  customer: RawCustomer,
  identity: RawCustomerIdentity | null | undefined
): Contact {
  const name =
    customer.display_name?.trim() ||
    [customer.first_name?.trim(), customer.last_name?.trim()]
      .filter(Boolean)
      .join(' ') ||
    identity?.display_name?.trim() ||
    identity?.username?.trim();

  return {
    // This is deliberately the canonical customer id, not a synthetic
    // contacts.id. Consumers use the flag below to keep legacy contact
    // mutations out of social-only customer records.
    id: customer.id,
    user_id: '',
    account_id: customer.account_id,
    phone: customer.phone ?? identity?.phone ?? null,
    whatsapp_user_id: identity?.external_id ?? null,
    whatsapp_username: identity?.username ?? null,
    name: name || undefined,
    email: customer.email ?? undefined,
    avatar_url: identity?.profile_picture_url ?? undefined,
    created_at: customer.created_at,
    updated_at: customer.updated_at,
    tags: [],
    is_canonical_customer: true,
    source_channel: identity?.channel,
  };
}

/**
 * Flatten the embedded `contact_tags(tags(*))` join into `contact.tags`.
 * Safe to call on rows fetched with {@link CONVERSATION_SELECT}; a row with
 * no contact (e.g. a freshly-inserted conversation) passes through untouched.
 */
export function normalizeConversation(raw: RawConversation): Conversation {
  const rawContact = raw.contact;
  if (!rawContact) {
    if (!raw.customer) return raw as Conversation;
    const { customer, customer_identity, ...conversation } = raw;
    return {
      ...conversation,
      contact: customerAsInboxContact(customer, customer_identity),
    } as Conversation;
  }

  const { contact_tags, ...contact } = rawContact;
  return {
    ...raw,
    contact: {
      ...contact,
      tags: (contact_tags ?? [])
        .map((ct) => ct.tags)
        .filter((t): t is Tag => t != null),
    },
  } as Conversation;
}

export function normalizeConversations(
  rows: RawConversation[]
): Conversation[] {
  return rows.map(normalizeConversation);
}

export interface ContactFilters {
  /** Tag ids; a conversation matches if its contact has ANY of them (OR). */
  tagIds: string[];
  /** Exact company match, or null for no company filter. */
  company: string | null;
}

/**
 * Whether a conversation passes the contact-based Inbox filters (issue #272).
 * Empty `tagIds` and null `company` are no-ops, so the default (no filters)
 * always matches. Tags use OR logic, consistent with Broadcast audiences.
 */
export function matchesContactFilters(
  conversation: Conversation,
  { tagIds, company }: ContactFilters
): boolean {
  if (tagIds.length > 0) {
    const contactTagIds = conversation.contact?.tags ?? [];
    if (!contactTagIds.some((t) => tagIds.includes(t.id))) return false;
  }

  if (company !== null && conversation.contact?.company?.trim() !== company) {
    return false;
  }

  return true;
}
