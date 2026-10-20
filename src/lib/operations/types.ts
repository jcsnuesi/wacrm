export interface OpsConfig {
  primary_activity: 'services' | 'products';
  additional_activities: ('services' | 'products')[];
  timezone: string;
  professional_label: string;
  public_slug: string;
  public_enabled: boolean;
  disabled_modules: string[];
  closing_stage_id: string | null;
}
export interface Professional {
  access?: {
    email: string;
    status: 'pending' | 'active' | 'suspended';
    modules: string[];
    sent_at: string | null;
    expires_at: string | null;
  } | null;
  id: string;
  name: string;
  specialty: string;
  photo_url: string | null;
  active: boolean;
  linked_email: string | null;
  service_bps: number | null;
  product_bps: number | null;
  hours: { weekday: number; start: string; end: string }[];
  service_count: number;
  product_count: number;
  commission_month: number | null;
  commission_balance: number | null;
  collected_month: number | null;
}
export interface Service {
  id: string;
  name: string;
  price_minor: number;
  duration_minutes: number;
  resource_id: string | null;
  active: boolean;
  professional_ids: string[];
  inputs: { product_id: string; quantity: number }[];
}
export interface Product {
  id: string;
  name: string;
  sku: string;
  price_minor: number;
  cost_minor: number | null;
  stock: number;
  sellable: boolean;
  active: boolean;
}
export interface OperationLine {
  id: string;
  kind: 'service' | 'product';
  name: string;
  professional_id: string | null;
  quantity: number;
  returned_quantity: number;
  net_minor: number;
  credited_minor: number;
  commission_bps?: number;
}
export interface Operation {
  id: string;
  appointment_id: string | null;
  client_name: string;
  status: 'open' | 'completed' | 'void';
  total_minor: number;
  collected_minor: number;
  closed_at: string | null;
  currency: string;
  lines: OperationLine[];
}
export interface Appointment {
  id: string;
  operation_id: string;
  client_name: string;
  client_phone: string;
  professional_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  source: string;
  services: { id: string; name: string; price_minor: number }[];
}
export interface Proof {
  id: string;
  operation_id: string;
  declared_minor: number;
  reference: string;
  bank: string;
  status: 'pending' | 'confirmed' | 'rejected';
  duplicate_warning: boolean;
  review_note: string;
  created_at: string;
  source_message_id: string | null;
}
export interface LedgerRow {
  id: string;
  amount_minor: number;
  created_at: string;
  professional_id?: string;
  operation_id?: string;
  reference?: string;
  method?: string;
  category?: string;
  note?: string;
}
export interface OpsData {
  allowed_modules?: string[];
  employee_modules?: { id: string; name: string; description: string }[];
  account_id: string;
  role: string;
  month: string;
  currency: string;
  config: OpsConfig | null;
  professionals: Professional[];
  services: Service[];
  products: Product[];
  resources: { id: string; name: string; active: boolean }[];
  appointments: Appointment[];
  operations: Operation[];
  proofs: Proof[];
  payments: LedgerRow[];
  commissions: LedgerRow[];
  settlements: LedgerRow[];
  expenses: LedgerRow[];
  stock_movements: {
    id: string;
    product_id: string;
    professional_id: string | null;
    kind: string;
    quantity: number;
    created_at: string;
    note: string;
  }[];
  stages: { id: string; name: string }[];
  deals: { id: string; title: string }[];
  finance?: {
    sales_minor: number;
    credits_minor: number;
    collected_minor: number;
    receivable_minor: number;
    advances_minor: number;
    cost_minor: number | null;
    commission_minor: number | null;
    expense_minor: number | null;
    settled_minor: number | null;
  };
}
