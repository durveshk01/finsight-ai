import { Account, ForecastMetric, Invoice, LocalForecast, MobileKpis, ScenarioParams, Snapshot, Transaction } from "../types";
import { addDays, daysBetween, today, toMinor } from "./money";
export { formatCurrency } from "./money";

function obligations(transactions: Transaction[], invoices: Invoice[], asOf: string) {
  const invoiceNumbers = new Set(invoices.map((invoice) => invoice.invoice_number.trim().toLowerCase()));
  return transactions.filter((transaction) => transaction.kind !== "transfer" &&
    (transaction.status !== "completed" || transaction.date > asOf) &&
    !(transaction.reference && invoiceNumbers.has(transaction.reference.trim().toLowerCase())));
}

export function calculateMobileKpis(transactions: Transaction[], invoices: Invoice[], openingCash: number, minimumReserve: number, asOf = today()): MobileKpis {
  let revenue = 0;
  let expenses = 0;
  let burn = 0;
  let receivables = 0;
  let payables = 0;
  const recent = addDays(asOf, -89);
  for (const transaction of transactions) {
    if (transaction.status !== "completed" || transaction.date > asOf || transaction.kind === "transfer") continue;
    const amount = toMinor(transaction.amount);
    if (transaction.kind === "income") revenue += amount;
    else expenses += amount;
    if (transaction.date >= recent) burn += transaction.kind === "income" ? -amount : amount;
  }
  for (const transaction of obligations(transactions, invoices, asOf)) {
    if (transaction.kind === "income") receivables += toMinor(transaction.amount);
    else payables += toMinor(transaction.amount);
  }
  for (const invoice of invoices) {
    const due = Math.max(0, toMinor(invoice.amount) - toMinor(invoice.amount_paid));
    if (invoice.direction === "receivable") receivables += due;
    else payables += due;
  }
  const cash = toMinor(openingCash) + revenue - expenses;
  return {
    revenue: revenue / 100, expenses: expenses / 100, netCashFlow: (revenue - expenses) / 100,
    currentCash: cash / 100, cashMarginPct: revenue > 0 ? Math.round((revenue - expenses) / revenue * 1000) / 10 : 0,
    cashRunwayDays: cash <= 0 ? 0 : burn > 0 ? Math.floor(cash / (burn / 90)) : null,
    accountsReceivable: receivables / 100, accountsPayable: payables / 100,
    workingCapital: (cash + receivables - payables) / 100, minimumReserve,
  };
}

export function calculateCategoryMix(transactions: Transaction[], kind: "income" | "expense", asOf = today()) {
  const totals = new Map<string, { amount: number; count: number }>();
  let overall = 0;
  for (const transaction of transactions) {
    if (transaction.status !== "completed" || transaction.kind !== kind || transaction.date > asOf) continue;
    const previous = totals.get(transaction.category) ?? { amount: 0, count: 0 };
    const amount = toMinor(transaction.amount);
    totals.set(transaction.category, { amount: previous.amount + amount, count: previous.count + 1 });
    overall += amount;
  }
  return [...totals.entries()].map(([category, value]) => ({
    category, amount: value.amount / 100, count: value.count,
    sharePct: overall > 0 ? Math.round(value.amount / overall * 1000) / 10 : 0,
  })).sort((a, b) => b.amount - a.amount);
}

export function accountBalance(account: Account, transactions: Transaction[], asOf = today()): number {
  let balance = toMinor(account.opening_balance);
  for (const transaction of transactions) {
    if (transaction.status !== "completed" || transaction.date > asOf) continue;
    const amount = toMinor(transaction.amount);
    if (transaction.account_id === account.id) balance += transaction.kind === "income" ? amount : -amount;
    if (transaction.kind === "transfer" && transaction.to_account_id === account.id) balance += amount;
  }
  return balance / 100;
}

export function invoiceAgeing(invoices: Invoice[], asOf = today()) {
  const buckets = { Current: 0, "1–30 days": 0, "31–60 days": 0, "61–90 days": 0, "90+ days": 0 };
  for (const invoice of invoices) {
    const amount = Math.max(0, toMinor(invoice.amount) - toMinor(invoice.amount_paid));
    const overdue = daysBetween(invoice.due_date, asOf);
    const bucket = overdue <= 0 ? "Current" : overdue <= 30 ? "1–30 days" : overdue <= 60 ? "31–60 days" : overdue <= 90 ? "61–90 days" : "90+ days";
    buckets[bucket] += amount;
  }
  return Object.entries(buckets).map(([label, minor]) => ({ label, amount: minor / 100 }));
}

export function monthlySummary(transactions: Transaction[], asOf = today()) {
  const months = new Map<string, { revenue: number; expenses: number }>();
  for (const transaction of transactions) {
    if (transaction.status !== "completed" || transaction.date > asOf || transaction.kind === "transfer") continue;
    const key = transaction.date.slice(0, 7);
    const row = months.get(key) ?? { revenue: 0, expenses: 0 };
    row[transaction.kind === "income" ? "revenue" : "expenses"] += toMinor(transaction.amount);
    months.set(key, row);
  }
  return [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, row]) => ({
    month, revenue: row.revenue / 100, expenses: row.expenses / 100, net: (row.revenue - row.expenses) / 100,
  }));
}

function historySeries(transactions: Transaction[], asOf: string) {
  const completed = transactions.filter((row) => row.status === "completed" && row.kind !== "transfer" && row.date <= asOf);
  const first = completed.reduce((earliest, row) => row.date < earliest ? row.date : earliest, asOf);
  const length = completed.length ? Math.min(90, daysBetween(first, asOf) + 1) : 0;
  const series = Array.from({ length }, (_, index) => ({ date: addDays(asOf, index - length + 1), income: 0, expense: 0 }));
  const indices = new Map(series.map((row, index) => [row.date, index]));
  for (const row of completed) {
    const index = indices.get(row.date);
    if (index != null && row.kind !== "transfer") series[index][row.kind] += toMinor(row.amount);
  }
  return { series, completedCount: completed.filter((row) => indices.has(row.date)).length };
}

function selectAverage(series: { income: number; expense: number }[], kind: "income" | "expense", sufficient: boolean) {
  if (!sufficient) return { daily: 0, model: "Confirmed obligations only", metrics: [] as ForecastMetric[] };
  // Expanding-window, one-day-ahead holdouts. Every estimate uses only earlier days.
  const holdout = Math.min(14, Math.floor(series.length / 3));
  const windows = [7, 14, 30];
  const metrics = windows.map((window) => {
    let error = 0;
    let actual = 0;
    for (let index = series.length - holdout; index < series.length; index++) {
      const train = series.slice(Math.max(0, index - window), index);
      const prediction = train.reduce((sum, row) => sum + row[kind], 0) / train.length;
      error += Math.abs(series[index][kind] - prediction);
      actual += series[index][kind];
    }
    return { model: `${window}-day moving average`, mae: error / holdout / 100, wape: actual > 0 ? error / actual * 100 : null, selected: false, window };
  });
  const best = [...metrics].sort((a, b) => a.mae - b.mae || a.window - b.window)[0];
  const recent = series.slice(-best.window);
  return {
    daily: Math.round(recent.reduce((sum, row) => sum + row[kind], 0) / recent.length),
    model: best.model,
    metrics: metrics.map((metric) => ({ model: metric.model, mae: Math.round(metric.mae * 100) / 100, wape: metric.wape == null ? null : Math.round(metric.wape * 10) / 10, selected: metric.window === best.window })),
  };
}

export const BASE_SCENARIO: ScenarioParams = {
  revenue_change_pct: 0, expense_change_pct: 0, receivables_delay_days: 0, payables_delay_days: 0, one_time_cost: 0, horizon_days: 30,
};

export function forecastLocal(snapshot: Snapshot, params: ScenarioParams = BASE_SCENARIO, asOf = today()): LocalForecast {
  const { transactions, invoices, business } = snapshot;
  const { series, completedCount } = historySeries(transactions, asOf);
  const sufficient = series.length >= 14 && completedCount >= 6;
  const revenue = selectAverage(series, "income", sufficient);
  const expenses = selectAverage(series, "expense", sufficient);
  const dailyIncome = Math.round(revenue.daily * (1 + params.revenue_change_pct / 100));
  const dailyExpense = Math.round(expenses.daily * (1 + params.expense_change_pct / 100));
  const kpis = calculateMobileKpis(transactions, invoices, business.opening_cash, business.minimum_reserve, asOf);
  const opening = toMinor(kpis.currentCash);
  let cash = opening - toMinor(params.one_time_cost);
  let minimum = Math.min(opening, cash);
  let inflowTotal = 0;
  let outflowTotal = toMinor(params.one_time_cost);
  let breach = cash < toMinor(business.minimum_reserve) ? asOf : null;
  const confirmed = new Map<string, { income: number; expense: number }>();
  const addObligation = (date: string, kind: "income" | "expense", amount: number) => {
    const shifted = addDays(date <= asOf ? addDays(asOf, 1) : date, kind === "income" ? params.receivables_delay_days : params.payables_delay_days);
    const row = confirmed.get(shifted) ?? { income: 0, expense: 0 };
    row[kind] += amount;
    confirmed.set(shifted, row);
  };
  for (const transaction of obligations(transactions, invoices, asOf)) {
    if (transaction.kind !== "transfer") addObligation(transaction.date, transaction.kind, toMinor(transaction.amount));
  }
  for (const invoice of invoices) {
    const due = Math.max(0, toMinor(invoice.amount) - toMinor(invoice.amount_paid));
    if (due > 0) addObligation(invoice.due_date, invoice.direction === "receivable" ? "income" : "expense", due);
  }
  const days = Array.from({ length: params.horizon_days }, (_, index) => {
    const date = addDays(asOf, index + 1);
    const known = confirmed.get(date) ?? { income: 0, expense: 0 };
    const income = dailyIncome + known.income;
    const expense = dailyExpense + known.expense;
    cash += income - expense;
    minimum = Math.min(minimum, cash);
    inflowTotal += income;
    outflowTotal += expense;
    if (!breach && cash < toMinor(business.minimum_reserve)) breach = date;
    return { date, inflows: income / 100, outflows: expense / 100, balance: cash / 100 };
  });
  return {
    days, openingCash: opening / 100, closingCash: cash / 100, minimumCash: minimum / 100,
    projectedRevenue: inflowTotal / 100, projectedExpenses: outflowTotal / 100,
    breachDate: breach, historyDays: series.length, historySufficient: sufficient,
    model: revenue.model, metrics: revenue.metrics,
  };
}
