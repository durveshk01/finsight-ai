export type TransactionKind = "income" | "expense" | "transfer";

export interface Transaction {
  id: number;
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
  is_offline_draft?: boolean;
}

export interface Account {
  id: number;
  name: string;
  account_type: "bank" | "cash" | "card" | "wallet";
  currency: string;
  opening_balance: number;
  current_balance: number;
  balance?: number;
  is_active: boolean;
}

export interface Invoice {
  id: number;
  direction: "receivable" | "payable";
  invoice_number: string;
  counterparty: string;
  issue_date: string;
  due_date: string;
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  category: string;
  status: "open" | "paid" | "partially_paid" | "overdue";
  description: string;
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

export interface FinancialOverview {
  total_revenue: number;
  total_expenses: number;
  net_cash_flow: number;
  cash_balance: number;
  net_cash_margin: number;
  cash_runway_months: number;
  outstanding_receivables: number;
  outstanding_payables: number;
  working_capital: number;
}

export interface OfflineMutation {
  client_mutation_id: string;
  entity_type: "transaction" | "account" | "invoice";
  action: "create" | "update" | "delete";
  entity_id?: number;
  data: Record<string, any>;
  timestamp?: string;
  created_at?: string;
}

export interface ScenarioParams {
  name?: string;
  revenue_growth_pct: number;
  expense_growth_pct: number;
  receivables_delay_days: number;
  payables_delay_days: number;
  one_off_capex: number;
  projection_days: number;
}

export interface ScenarioResult {
  projected_ending_cash: number;
  net_cash_delta: number;
  runway_months: number;
  projected_burn_rate: number;
  breach_date: string | null;
}

export interface SyncStatus {
  lastSync: string | null;
  lastSeq: number;
  pendingCount: number;
}
