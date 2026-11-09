export type TransactionKind = "income" | "expense" | "transfer";
export type WorkspaceRole = "owner" | "admin" | "accountant" | "viewer";

export interface User {
  id: number;
  name: string;
  email: string;
}

export interface Business {
  id: number;
  name: string;
  currency: string;
  opening_cash: number;
  minimum_reserve: number;
  is_demo?: boolean;
}

export interface Session {
  workspaceId: string;
  mode: "local" | "cloud";
  apiUrl: string | null;
  token: string | null;
  user: User;
  business: Business;
  role: WorkspaceRole;
}

export interface TransactionInput {
  kind: TransactionKind;
  category: string;
  amount: number;
  date: string;
  description: string;
  payment_method: string;
  status: "completed" | "pending" | "scheduled";
  reference?: string | null;
  account_id?: number | null;
  to_account_id?: number | null;
}

export interface Transaction extends TransactionInput {
  id: number;
  business_id?: number;
  is_offline_draft?: boolean;
  invoice_id?: number | null;
}

export interface AccountInput {
  name: string;
  account_type: "bank" | "cash" | "card" | "wallet";
  currency: string;
  opening_balance: number;
}

export interface Account extends AccountInput {
  id: number;
  current_balance?: number;
  is_active: boolean;
}

export interface InvoiceInput {
  direction: "receivable" | "payable";
  invoice_number: string;
  counterparty: string;
  issue_date: string;
  due_date: string;
  amount: number;
  currency: string;
  category: string;
  description: string;
  account_id?: number | null;
}

export interface Invoice extends InvoiceInput {
  id: number;
  amount_paid: number;
  amount_due: number;
  status: "open" | "paid" | "partially_paid" | "overdue";
  is_offline_draft?: boolean;
}

export interface PaymentInput {
  invoice_id: number;
  amount: number;
  paid_on: string;
  payment_method: string;
  account_id?: number | null;
  reference?: string | null;
}

export type EntityType = "transaction" | "account" | "invoice" | "payment" | "business";

export interface OfflineMutation {
  client_mutation_id: string;
  entity_type: EntityType;
  action: "create" | "update" | "delete";
  entity_id?: number;
  local_id: number;
  data: Record<string, unknown>;
  created_at: string;
  error?: string;
}

export interface Snapshot {
  business: Business;
  transactions: Transaction[];
  accounts: Account[];
  invoices: Invoice[];
}

export interface WorkspaceData {
  version: 1;
  snapshot: Snapshot;
  queue: OfflineMutation[];
  nextId: number;
  sync: { latestSeq: number; lastSyncTime: string | null; lastError: string | null };
}

export interface SyncChange {
  seq_num: number;
  entity_type: string;
  entity_id: number;
  action: string;
  data: Record<string, unknown>;
}

export interface SyncPullResponse {
  protocol_version: 2;
  mode: "baseline" | "delta";
  latest_seq: number;
  new_seq?: number;
  has_more: boolean;
  data?: Omit<Snapshot, "business">;
  business: Business;
  role: WorkspaceRole;
  changes?: SyncChange[];
}

export interface MutationAcknowledgement {
  client_mutation_id: string;
  entity_id: number;
  entity_type?: EntityType;
  record?: Record<string, unknown>;
  invoice?: Invoice;
  transaction?: Transaction;
}

export interface SyncPushResponse {
  applied: MutationAcknowledgement[];
  conflicts: { client_mutation_id: string; error: string }[];
}

export interface MobileKpis {
  revenue: number;
  expenses: number;
  netCashFlow: number;
  currentCash: number;
  cashMarginPct: number;
  cashRunwayDays: number | null;
  accountsReceivable: number;
  accountsPayable: number;
  workingCapital: number;
  minimumReserve: number;
}

export interface ScenarioParams {
  revenue_change_pct: number;
  expense_change_pct: number;
  receivables_delay_days: number;
  payables_delay_days: number;
  one_time_cost: number;
  horizon_days: number;
}

export interface ForecastDay {
  date: string;
  inflows: number;
  outflows: number;
  balance: number;
}

export interface ForecastMetric {
  model: string;
  mae: number;
  wape: number | null;
  selected: boolean;
}

export interface LocalForecast {
  days: ForecastDay[];
  openingCash: number;
  closingCash: number;
  minimumCash: number;
  projectedRevenue: number;
  projectedExpenses: number;
  breachDate: string | null;
  historyDays: number;
  historySufficient: boolean;
  model: string;
  metrics: ForecastMetric[];
}
