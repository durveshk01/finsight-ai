/**
 * FinSight AI - Device-Powered Financial Intelligence Engine
 * 
 * Provides local-first, high-precision financial calculations, aggregations,
 * scenario simulations, validation, and offline synchronization queues that run
 * directly on client devices (Web and Mobile) without requiring redundant backend roundtrips.
 */

export interface TransactionRecord {
  id: number;
  kind: "income" | "expense" | "transfer";
  category: string;
  amount: number;
  date: string; // YYYY-MM-DD
  description: string;
  payment_method: string;
  status: "completed" | "pending" | "scheduled";
  reference?: string | null;
  account_id?: number | null;
  to_account_id?: number | null;
  created_at?: string | null;
}

export interface AccountRecord {
  id: number;
  name: string;
  account_type: "bank" | "cash" | "card" | "wallet";
  currency: string;
  opening_balance: number;
  current_balance: number;
  is_active: boolean;
}

export interface InvoiceRecord {
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
  account_id: number | null;
  status: "open" | "paid" | "partially_paid" | "overdue";
  description: string;
}

export interface DateRangeFilter {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
  preset?: string;
}

export interface FinancialKpiResult {
  revenue: number;
  expenses: number;
  netCashFlow: number;
  currentCash: number;
  cashMarginPct: number;
  cashRunwayDays: number | null;
  averageMonthlyBurn: number;
  accountsReceivable: number;
  accountsPayable: number;
  workingCapital: number;
  revenueGrowthPct: number | null;
  expenseGrowthPct: number | null;
  netGrowthPct: number | null;
  previousRevenue: number;
  previousExpenses: number;
  previousNetCashFlow: number;
}

export interface CategorySummary {
  category: string;
  amount: number;
  sharePct: number;
}

export interface ScenarioParameters {
  revenue_change_pct: number;
  expense_change_pct: number;
  one_time_cost: number;
  new_monthly_revenue: number;
  marketing_reduction_pct: number;
  salary_increase_pct: number;
  inventory_increase_pct: number;
  new_hire_monthly_cost: number;
  campaign_monthly_cost: number;
  additional_loan_payment: number;
  loan_proceeds: number;
  capital_investment: number;
  horizon_months: number;
}

export interface ScenarioSimulationResult {
  monthlyRevenue: number;
  monthlyExpenses: number;
  monthlyNetCashFlow: number;
  closingCash: number;
  cashRunwayDays: number | null;
  riskCategory: "low" | "moderate" | "high";
  reserveBreachDate: string | null;
}

export interface OfflineMutation {
  client_mutation_id: string;
  entity_type: "transaction" | "account" | "invoice" | "recurring" | "scenario" | "category";
  action: "create" | "update" | "delete";
  entity_id?: number;
  data: Record<string, unknown>;
  timestamp: string;
}

// -------------------------------------------------------------
// Decimal-safe utility functions
// -------------------------------------------------------------

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

export function parseISODate(isoStr: string): Date {
  const parts = isoStr.split("T")[0].split("-");
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

export function formatISODate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// -------------------------------------------------------------
// Date range helpers
// -------------------------------------------------------------

export function getDateRangeFromPreset(preset: string, today: Date = new Date()): DateRangeFilter {
  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const nowStr = formatISODate(now);

  switch (preset) {
    case "today":
      return { start: nowStr, end: nowStr, preset };
    case "last_7_days": {
      const d = new Date(now);
      d.setDate(d.getDate() - 6);
      return { start: formatISODate(d), end: nowStr, preset };
    }
    case "last_30_days": {
      const d = new Date(now);
      d.setDate(d.getDate() - 29);
      return { start: formatISODate(d), end: nowStr, preset };
    }
    case "this_month": {
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: formatISODate(d), end: nowStr, preset };
    }
    case "last_month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { start: formatISODate(start), end: formatISODate(end), preset };
    }
    case "this_quarter": {
      const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
      const start = new Date(now.getFullYear(), quarterStartMonth, 1);
      return { start: formatISODate(start), end: nowStr, preset };
    }
    case "this_year": {
      const start = new Date(now.getFullYear(), 0, 1);
      return { start: formatISODate(start), end: nowStr, preset };
    }
    default: {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 6);
      return { start: formatISODate(d), end: nowStr, preset: "last_6_months" };
    }
  }
}

// -------------------------------------------------------------
// Device-Powered Financial KPI Calculations
// -------------------------------------------------------------

export function calculateLocalKpis(
  transactions: TransactionRecord[],
  invoices: InvoiceRecord[],
  openingCash: number,
  minimumReserve: number,
  filter: DateRangeFilter
): FinancialKpiResult {
  const todayStr = formatISODate(new Date());

  // Current Cash = openingCash + all completed income through today - all completed expenses through today
  // Note: Transfers do NOT alter total business cash.
  let currentCash = openingCash;
  const recent90Date = new Date();
  recent90Date.setDate(recent90Date.getDate() - 90);
  const recent90Str = formatISODate(recent90Date);

  let burn90Income = 0;
  let burn90Expense = 0;

  for (const t of transactions) {
    if (t.status === "completed" && t.date <= todayStr) {
      if (t.kind === "income") currentCash += t.amount;
      else if (t.kind === "expense") currentCash -= t.amount;

      if (t.date >= recent90Str) {
        if (t.kind === "income") burn90Income += t.amount;
        else if (t.kind === "expense") burn90Expense += t.amount;
      }
    }
  }

  // Active period revenue & expenses
  let periodRevenue = 0;
  let periodExpenses = 0;

  for (const t of transactions) {
    if (t.status === "completed" && t.date >= filter.start && t.date <= filter.end) {
      if (t.kind === "income") periodRevenue += t.amount;
      else if (t.kind === "expense") periodExpenses += t.amount;
    }
  }

  const netCashFlow = round2(periodRevenue - periodExpenses);
  const cashMarginPct = periodRevenue > 0 ? round2((netCashFlow / periodRevenue) * 100) : 0;

  // Trailing burn rate & runway
  const dailyBurn = Math.max(0, (burn90Expense - burn90Income) / 90);
  const averageMonthlyBurn = round2(dailyBurn * 30);
  const cashRunwayDays = dailyBurn > 0 ? Math.round(currentCash / dailyBurn) : null;

  // Receivables & Payables (pending/scheduled transactions + unpaid invoices)
  let receivables = 0;
  let payables = 0;

  for (const t of transactions) {
    if (t.status === "pending" || t.status === "scheduled") {
      if (t.kind === "income") receivables += t.amount;
      else if (t.kind === "expense") payables += t.amount;
    }
  }

  const invoiceRefs = new Set(
    transactions
      .filter((t) => (t.status === "pending" || t.status === "scheduled") && t.reference)
      .map((t) => t.reference!.trim().toLowerCase())
  );

  for (const inv of invoices) {
    if (inv.status !== "paid" && inv.amount_due > 0) {
      if (!invoiceRefs.has(inv.invoice_number.trim().toLowerCase())) {
        if (inv.direction === "receivable") receivables += inv.amount_due;
        else payables += inv.amount_due;
      }
    }
  }

  const workingCapital = round2(currentCash + receivables - payables);

  // Prior period comparison
  const startDate = parseISODate(filter.start);
  const endDate = parseISODate(filter.end);
  const durationMs = endDate.getTime() - startDate.getTime();
  const priorEnd = new Date(startDate.getTime() - 86400000);
  const priorStart = new Date(priorEnd.getTime() - durationMs);
  const priorStartStr = formatISODate(priorStart);
  const priorEndStr = formatISODate(priorEnd);

  let priorRevenue = 0;
  let priorExpenses = 0;

  for (const t of transactions) {
    if (t.status === "completed" && t.date >= priorStartStr && t.date <= priorEndStr) {
      if (t.kind === "income") priorRevenue += t.amount;
      else if (t.kind === "expense") priorExpenses += t.amount;
    }
  }

  const priorNet = round2(priorRevenue - priorExpenses);
  const revGrowth = priorRevenue > 0 ? round2(((periodRevenue / priorRevenue) - 1) * 100) : (periodRevenue > 0 ? 100 : 0);
  const expGrowth = priorExpenses > 0 ? round2(((periodExpenses / priorExpenses) - 1) * 100) : (periodExpenses > 0 ? 100 : 0);
  const netGrowth = priorNet !== 0 ? round2((((netCashFlow - priorNet) / Math.abs(priorNet)) * 100)) : null;

  return {
    revenue: round2(periodRevenue),
    expenses: round2(periodExpenses),
    netCashFlow,
    currentCash: round2(currentCash),
    cashMarginPct,
    cashRunwayDays,
    averageMonthlyBurn,
    accountsReceivable: round2(receivables),
    accountsPayable: round2(payables),
    workingCapital,
    revenueGrowthPct: revGrowth,
    expenseGrowthPct: expGrowth,
    netGrowthPct: netGrowth,
    previousRevenue: round2(priorRevenue),
    previousExpenses: round2(priorExpenses),
    previousNetCashFlow: priorNet,
  };
}

// -------------------------------------------------------------
// Category Analytics
// -------------------------------------------------------------

export function calculateCategoryBreakdown(
  transactions: TransactionRecord[],
  kind: "income" | "expense",
  filter: DateRangeFilter
): CategorySummary[] {
  const totals: Record<string, number> = {};
  let overall = 0;

  for (const t of transactions) {
    if (t.status === "completed" && t.kind === kind && t.date >= filter.start && t.date <= filter.end) {
      totals[t.category] = (totals[t.category] ?? 0) + t.amount;
      overall += t.amount;
    }
  }

  const list: CategorySummary[] = Object.entries(totals).map(([category, amount]) => ({
    category,
    amount: round2(amount),
    sharePct: overall > 0 ? round2((amount / overall) * 100) : 0,
  }));

  list.sort((a, b) => b.amount - a.amount);
  return list;
}

// -------------------------------------------------------------
// Device-Powered Scenario Simulation Engine
// -------------------------------------------------------------

export function simulateScenarioLocally(
  baselineMonthlyRevenue: number,
  baselineMonthlyExpenses: number,
  currentCash: number,
  minimumReserve: number,
  params: ScenarioParameters
): ScenarioSimulationResult {
  const revMultiplier = 1 + params.revenue_change_pct / 100;
  const expMultiplier = 1 + params.expense_change_pct / 100;

  const adjRevenue = baselineMonthlyRevenue * revMultiplier + params.new_monthly_revenue;
  const adjExpenses = baselineMonthlyExpenses * expMultiplier
    + params.new_hire_monthly_cost
    + params.campaign_monthly_cost
    + params.additional_loan_payment;

  const monthlyNet = round2(adjRevenue - adjExpenses);
  const oneTimeNet = params.loan_proceeds - params.one_time_cost - params.capital_investment;
  const closingCash = round2(currentCash + oneTimeNet + monthlyNet * params.horizon_months);

  const dailyBurn = monthlyNet < 0 ? Math.abs(monthlyNet) / 30 : 0;
  const runway = dailyBurn > 0 ? Math.round(closingCash / dailyBurn) : null;

  let riskCategory: "low" | "moderate" | "high" = "low";
  if (closingCash < minimumReserve || (runway !== null && runway < 60)) {
    riskCategory = "high";
  } else if (runway !== null && runway < 120) {
    riskCategory = "moderate";
  }

  // Calculate earliest reserve breach date if any
  let breachDate: string | null = null;
  let runningCash = currentCash + oneTimeNet;
  const today = new Date();

  for (let m = 1; m <= params.horizon_months; m++) {
    runningCash += monthlyNet;
    if (runningCash < minimumReserve && !breachDate) {
      const d = new Date(today);
      d.setMonth(d.getMonth() + m);
      breachDate = formatISODate(d);
    }
  }

  return {
    monthlyRevenue: round2(adjRevenue),
    monthlyExpenses: round2(adjExpenses),
    monthlyNetCashFlow: monthlyNet,
    closingCash,
    cashRunwayDays: runway,
    riskCategory,
    reserveBreachDate: breachDate,
  };
}

// -------------------------------------------------------------
// Local Duplicate Detection & CSV Import Parsing
// -------------------------------------------------------------

export function detectDuplicates(
  newRows: { date: string; amount: number; kind: string; category: string }[],
  existingTransactions: TransactionRecord[]
): { uniqueRows: typeof newRows; duplicateCount: number } {
  const existingKeys = new Set(
    existingTransactions.map(
      (t) => `${t.date}_${t.kind}_${round2(t.amount)}_${t.category.trim().toLowerCase()}`
    )
  );

  const uniqueRows: typeof newRows = [];
  let duplicateCount = 0;

  for (const row of newRows) {
    const key = `${row.date}_${row.kind}_${round2(row.amount)}_${row.category.trim().toLowerCase()}`;
    if (existingKeys.has(key)) {
      duplicateCount++;
    } else {
      uniqueRows.push(row);
      existingKeys.add(key);
    }
  }

  return { uniqueRows, duplicateCount };
}

// -------------------------------------------------------------
// Offline Mutation Queue & Synchronization Helpers
// -------------------------------------------------------------

export class OfflineSyncQueue {
  private storageKey: string;

  constructor(storageKey = "finsight_offline_mutations") {
    this.storageKey = storageKey;
  }

  public getQueue(): OfflineMutation[] {
    if (typeof window === "undefined" || !window.localStorage) return [];
    try {
      const data = localStorage.getItem(this.storageKey);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  public enqueue(
    entityType: OfflineMutation["entity_type"],
    action: OfflineMutation["action"],
    data: Record<string, unknown>,
    entityId?: number
  ): OfflineMutation {
    const mutation: OfflineMutation = {
      client_mutation_id: `offline-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      entity_type: entityType,
      action,
      entity_id: entityId,
      data,
      timestamp: new Date().toISOString(),
    };

    const current = this.getQueue();
    current.push(mutation);
    if (typeof window !== "undefined" && window.localStorage) {
      localStorage.setItem(this.storageKey, JSON.stringify(current));
    }
    return mutation;
  }

  public remove(clientMutationId: string): void {
    const current = this.getQueue().filter((m) => m.client_mutation_id !== clientMutationId);
    if (typeof window !== "undefined" && window.localStorage) {
      localStorage.setItem(this.storageKey, JSON.stringify(current));
    }
  }

  public clear(): void {
    if (typeof window !== "undefined" && window.localStorage) {
      localStorage.removeItem(this.storageKey);
    }
  }
}
