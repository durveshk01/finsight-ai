import { describe, expect, it } from "vitest";
import {
  calculateCategoryBreakdown,
  calculateLocalKpis,
  detectDuplicates,
  getDateRangeFromPreset,
  round2,
  simulateScenarioLocally,
  type TransactionRecord,
} from "./financial-engine";

describe("Financial Engine - Local Calculations", () => {
  it("calculates round2 correctly with floating point values", () => {
    expect(round2(100.055)).toBe(100.06);
    expect(round2(200.1 + 0.2)).toBe(200.3);
  });

  it("calculates date range from presets accurately", () => {
    const today = new Date("2026-11-07T12:00:00Z");
    const r7 = getDateRangeFromPreset("last_7_days", today);
    expect(r7.start).toBe("2026-11-01");
    expect(r7.end).toBe("2026-11-07");

    const r30 = getDateRangeFromPreset("last_30_days", today);
    expect(r30.start).toBe("2026-10-09");
    expect(r30.end).toBe("2026-11-07");

    const rMonth = getDateRangeFromPreset("this_month", today);
    expect(rMonth.start).toBe("2026-11-01");
    expect(rMonth.end).toBe("2026-11-07");
  });

  it("computes accurate KPIs without treating transfers as revenue or expense", () => {
    const transactions: TransactionRecord[] = [
      { id: 1, kind: "income", category: "Sales Revenue", amount: 10000, date: "2026-11-02", description: "Sale", payment_method: "Bank", status: "completed" },
      { id: 2, kind: "expense", category: "Rent", amount: 3000, date: "2026-11-03", description: "Rent", payment_method: "Bank", status: "completed" },
      { id: 3, kind: "transfer", category: "Transfer", amount: 2000, date: "2026-11-04", description: "Transfer to Savings", payment_method: "Bank", status: "completed", account_id: 1, to_account_id: 2 },
      { id: 4, kind: "income", category: "Invoice Due", amount: 1500, date: "2026-11-15", description: "Scheduled sale", payment_method: "Bank", status: "pending" },
    ];

    const kpi = calculateLocalKpis(
      transactions,
      [],
      5000, // opening cash
      1000, // min reserve
      { start: "2026-11-01", end: "2026-11-30" }
    );

    // Revenue: 10000 (transfers not included)
    expect(kpi.revenue).toBe(10000);
    // Expenses: 3000 (transfers not included)
    expect(kpi.expenses).toBe(3000);
    // Net cash flow: 7000
    expect(kpi.netCashFlow).toBe(7000);
    // Current cash: 5000 + 10000 - 3000 = 12000 (transfers do not alter overall cash)
    expect(kpi.currentCash).toBe(12000);
    // Accounts receivable: 1500
    expect(kpi.accountsReceivable).toBe(1500);
    // Margin: 70%
    expect(kpi.cashMarginPct).toBe(70);
  });

  it("calculates category breakdown shares properly", () => {
    const transactions: TransactionRecord[] = [
      { id: 1, kind: "expense", category: "Rent", amount: 3000, date: "2026-11-01", description: "", payment_method: "", status: "completed" },
      { id: 2, kind: "expense", category: "Salaries", amount: 7000, date: "2026-11-02", description: "", payment_method: "", status: "completed" },
    ];

    const breakdown = calculateCategoryBreakdown(transactions, "expense", { start: "2026-11-01", end: "2026-11-30" });
    expect(breakdown).toHaveLength(2);
    expect(breakdown[0].category).toBe("Salaries");
    expect(breakdown[0].sharePct).toBe(70);
    expect(breakdown[1].category).toBe("Rent");
    expect(breakdown[1].sharePct).toBe(30);
  });

  it("runs what-if scenario simulations correctly on the client", () => {
    const result = simulateScenarioLocally(
      20000, // baseline monthly rev
      15000, // baseline monthly exp
      50000, // current cash
      20000, // min reserve
      {
        revenue_change_pct: 10, // +10% rev -> 22000
        expense_change_pct: 0,
        one_time_cost: 0,
        new_monthly_revenue: 0,
        marketing_reduction_pct: 0,
        salary_increase_pct: 0,
        inventory_increase_pct: 0,
        new_hire_monthly_cost: 2000, // +2000 exp -> 17000
        campaign_monthly_cost: 0,
        additional_loan_payment: 0,
        loan_proceeds: 0,
        capital_investment: 0,
        horizon_months: 6,
      }
    );

    expect(result.monthlyRevenue).toBe(22000);
    expect(result.monthlyExpenses).toBe(17000);
    expect(result.monthlyNetCashFlow).toBe(5000);
    // Closing cash = 50000 + 5000 * 6 = 80000
    expect(result.closingCash).toBe(80000);
    expect(result.riskCategory).toBe("low");
  });

  it("detects duplicates accurately", () => {
    const existing: TransactionRecord[] = [
      { id: 1, kind: "income", category: "Sales Revenue", amount: 500, date: "2026-11-01", description: "", payment_method: "", status: "completed" },
    ];

    const incoming = [
      { kind: "income", category: "Sales Revenue", amount: 500, date: "2026-11-01" }, // duplicate
      { kind: "income", category: "Sales Revenue", amount: 600, date: "2026-11-01" }, // new
    ];

    const { uniqueRows, duplicateCount } = detectDuplicates(incoming, existing);
    expect(duplicateCount).toBe(1);
    expect(uniqueRows).toHaveLength(1);
    expect(uniqueRows[0].amount).toBe(600);
  });
});
