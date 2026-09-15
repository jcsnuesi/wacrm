export interface Customer360Identity {
  id: string;
  channel: string;
  username?: string | null;
  display_name?: string | null;
  external_id: string;
  phone?: string | null;
  last_seen_at?: string | null;
}

export interface Customer360ChannelAccount {
  channel: string;
  display_name?: string | null;
}

export interface Customer360Conversation {
  id: string;
  status: string;
  last_message_text?: string | null;
  last_message_at?: string | null;
  channel_account?: Customer360ChannelAccount | null;
}

export interface Customer360Summary {
  id: string;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  status: string;
  created_at?: string | null;
  updated_at?: string | null;
  contact_identities?: Customer360Identity[];
  conversations?: Customer360Conversation[];
}

export interface Customer360Detail extends Customer360Summary {
  created_at: string;
  updated_at: string;
}

export interface Customer360ListResponse {
  customers: Customer360Summary[];
}

export interface Customer360DetailResponse {
  customer: Customer360Detail;
}
