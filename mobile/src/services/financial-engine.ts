import { MobileKpis, Transaction, Invoice } from "../types";

export function calculateMobileKpis(
  transactions: Transaction[],
  invoices: Invoice[],
  openingCash: number,
  minimumReserve: number
): MobileKpis {
  const todayStr = new Date().toISOString().slice(0, 10);
  const recent90Date = new Date();
  recent90Date.setDate(recent90Date.getDate() - 90);
  const recent90Str = recent90Date.toISOString().slice(0, 10);

  let currentCash = openingCash;
  let revenue = 0;
  let expenses = 0;
  let burn90Income = 0;
  let burn90Expense = 0;
  let receivables = 0;
  let payables = 0;

  for (const t of transactions) {
    if (t.status === "completed" && t.date <= todayStr) {
      if (t.kind === "income") {
        currentCash += t.amount;
        revenue += t.amount;
      } else if (t.kind === "expense") {
        currentCash -= t.amount;
        expenses += t.amount;
      }
      // Note: kind === "transfer" moves money between accounts, does not change total cash.

      if (t.date >= recent90Str) {
        if (t.kind === "income") burn90Income += t.amount;
        else if (t.kind === "expense") burn90Expense += t.amount;
      }
    } else if (t.status === "pending" || t.status === "scheduled") {
      if (t.kind === "income") receivables += t.amount;
      else if (t.kind === "expense") payables += t.amount;
    }
  }

  for (const inv of invoices) {
    if (inv.status !== "paid" && inv.amount_due > 0) {
      if (inv.direction === "receivable") receivables += inv.amount_due;
      else payables += inv.amount_due;
    }
  }

  const netCashFlow = Math.round((revenue - expenses) * 100) / 100;
  const cashMarginPct = revenue > 0 ? Math.round((netCashFlow / revenue) * 1000) / 10 : 0;
  const dailyBurn = Math.max(0, (burn90Expense - burn90Income) / 90);
  const cashRunwayDays = dailyBurn > 0 ? Math.round(currentCash / dailyBurn) : null;
  const workingCapital = Math.round((currentCash + receivables - payables) * 100) / 100;

  return {
    revenue: Math.round(revenue * 100) / 100,
    expenses: Math.round(expenses * 100) / 100,
    netCashFlow,
    currentCash: Math.round(currentCash * 100) / 100,
    cashMarginPct,
    cashRunwayDays,
    accountsReceivable: Math.round(receivables * 100) / 100,
    accountsPayable: Math.round(payables * 100) / 100,
    workingCapital,
    minimumReserve,
  };
}

export function calculateCategoryMix(transactions: Transaction[], kind: "income" | "expense") {
  const totals: Record<string, number> = {};
  let overall = 0;

  for (const t of transactions) {
    if (t.status === "completed" && t.kind === kind) {
      totals[t.category] = (totals[t.category] ?? 0) + t.amount;
      overall += t.amount;
    }
  }

  return Object.entries(totals)
    .map(([cat, amt]) => ({
      category: cat,
      amount: Math.round(amt * 100) / 100,
      sharePct: overall > 0 ? Math.round((amt / overall) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

export function simulateMobileScenario(
  baseRev: number,
  baseExp: number,
  currentCash: number,
  minReserve: number,
  growthPct: number,
  newHires: number,
  horizonMonths: number = 6
) {
  const adjRev = baseRev * (1 + growthPct / 100);
  const adjExp = baseExp + newHires * 65000;
  const monthlyNet = Math.round((adjRev - adjExp) * 100) / 100;
  const closingCash = Math.round((currentCash + monthlyNet * horizonMonths) * 100) / 100;

  const burn = monthlyNet < 0 ? Math.abs(monthlyNet) / 30 : 0;
  const runway = burn > 0 ? Math.round(closingCash / burn) : null;

  return {
    monthlyRevenue: Math.round(adjRev * 100) / 100,
    monthlyExpenses: Math.round(adjExp * 100) / 100,
    monthlyNetCashFlow: monthlyNet,
    closingCash,
    cashRunwayDays: runway,
    risk: closingCash < minReserve ? "High Risk" : runway && runway < 120 ? "Moderate Risk" : "Healthy Buffer",
  };
}

export const DeviceFinancialEngine = {
  calculateKPIs(transactions: Transaction[], currentCash: number): FinancialOverview {
    const kpis = calculateMobileKpis(transactions, [], currentCash, 0);
    return {
      total_revenue: kpis.revenue,
      total_expenses: kpis.expenses,
      net_cash_flow: kpis.netCashFlow,
      cash_balance: kpis.currentCash,
      net_cash_margin: kpis.revenue > 0 ? kpis.netCashFlow / kpis.revenue : 0,
      cash_runway_months: kpis.cashRunwayDays ? kpis.cashRunwayDays / 30 : 99,
      outstanding_receivables: kpis.accountsReceivable,
      outstanding_payables: kpis.accountsPayable,
      working_capital: kpis.workingCapital,
    };
  },

  aggregateCategorySpending(transactions: Transaction[]) {
    const mix = calculateCategoryMix(transactions, "expense");
    return mix.map((m) => ({
      category: m.category,
      total: m.amount,
      percentage: m.sharePct,
      transaction_count: transactions.filter((t) => t.category === m.category).length,
    }));
  },

  simulateScenario(
    transactions: Transaction[],
    params: {
      revenue_growth_pct: number;
      expense_growth_pct: number;
      receivables_delay_days: number;
      payables_delay_days: number;
      one_off_capex: number;
      projection_days: number;
    },
    openingCash: number
  ) {
    let rev = 0;
    let exp = 0;
    for (const t of transactions) {
      if (t.kind === "income") rev += t.amount;
      else if (t.kind === "expense") exp += t.amount;
    }
    const monthlyRev = rev > 0 ? (rev / 3) * (1 + params.revenue_growth_pct / 100) : 25000 * (1 + params.revenue_growth_pct / 100);
    const monthlyExp = exp > 0 ? (exp / 3) * (1 + params.expense_growth_pct / 100) : 18000 * (1 + params.expense_growth_pct / 100);
    const monthlyNet = monthlyRev - monthlyExp;
    const months = params.projection_days / 30;
    const projectedEndingCash = openingCash + (monthlyNet * months) - params.one_off_capex;
    const burnRate = monthlyExp > monthlyRev ? monthlyExp - monthlyRev : 0;
    const runwayMonths = burnRate > 0 ? Math.max(0, projectedEndingCash / burnRate) : 99;

    let breachDate: string | null = null;
    if (projectedEndingCash < 10000) {
      const breachDay = Math.max(1, Math.floor((openingCash - 10000) / Math.max(1, (burnRate / 30))));
      const d = new Date();
      d.setDate(d.getDate() + breachDay);
      breachDate = d.toISOString().slice(0, 10);
    }

    return {
      projected_ending_cash: Math.round(projectedEndingCash * 100) / 100,
      net_cash_delta: Math.round((projectedEndingCash - openingCash) * 100) / 100,
      runway_months: runwayMonths,
      projected_burn_rate: Math.round(burnRate * 100) / 100,
      breach_date: breachDate,
    };
  },
};

