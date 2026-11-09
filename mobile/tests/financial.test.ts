import { accountBalance, BASE_SCENARIO, calculateCategoryMix, calculateMobileKpis, forecastLocal, invoiceAgeing, monthlySummary } from "../src/services/financial-engine";
import { addDays, daysBetween, parseAmount, toMinor, validDate } from "../src/services/money";
import { validateInvoice, validatePayment, validateTransaction } from "../src/services/validation";
import { account, invoice, snapshot, transaction } from "./fixtures";

describe("money and real calendar dates", () => {
  test.each([["0.10", 10], ["0.2", 20], ["-12.05", -1205], ["999999999999.99", 99999999999999]])("%s converts without rounding", (value, expected) => {
    expect(toMinor(value)).toBe(expected);
  });
  test.each(["", "NaN", "Infinity", "1e4", "1.001", "1,000", "1000000000000", "--1"])("rejects invalid money %s", (value) => {
    expect(() => toMinor(value)).toThrow();
  });
  test("zero and negative opening cash require explicit permission", () => {
    expect(() => parseAmount("0")).toThrow();
    expect(() => parseAmount("-10", true)).toThrow();
    expect(parseAmount("-10.01", true, true)).toBe(-10.01);
    expect(parseAmount("0", true)).toBe(0);
  });
  test("calendar operations handle leap days and month boundaries", () => {
    expect(validDate("2024-02-29")).toBe(true);
    expect(validDate("2025-02-29")).toBe(false);
    expect(validDate("2025-04-31")).toBe(false);
    expect(addDays("2024-02-28", 2)).toBe("2024-03-01");
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2);
  });
});

describe("actual cash, account allocations, and obligations", () => {
  const transactions = [
    transaction({ id: 1, amount: 0.1, account_id: 1 }),
    transaction({ id: 2, amount: 0.2, account_id: 1 }),
    transaction({ id: 3, kind: "expense", category: "Rent", amount: 250, account_id: 1 }),
    transaction({ id: 4, kind: "transfer", amount: 500, account_id: 1, to_account_id: 2 }),
    transaction({ id: 5, amount: 100, status: "pending", reference: "inv-11" }),
    transaction({ id: 6, amount: 30, invoice_id: 11, reference: "INV-11", account_id: 1 }),
    transaction({ id: 7, amount: 40, status: "pending", reference: "Other order" }),
    transaction({ id: 8, kind: "expense", amount: 20, date: "2025-02-01", status: "scheduled" }),
  ];
  const invoices = [invoice({ amount_paid: 30, amount_due: 70 })];
  const data = snapshot({ transactions, invoices, accounts: [account(), account({ id: 2, name: "Cash", opening_balance: 0 })] });
  test("cash adds opening once, excludes transfers/pending records and counts invoice receipts once", () => {
    const kpis = calculateMobileKpis(transactions, invoices, 1000, 200, "2025-01-31");
    expect(kpis).toMatchObject({ revenue: 30.3, expenses: 250, currentCash: 780.3, netCashFlow: -219.7, accountsReceivable: 110, accountsPayable: 20, workingCapital: 870.3 });
    expect(kpis.cashRunwayDays).toBe(319);
    expect(accountBalance(data.accounts[0], transactions, "2025-01-31")).toBe(280.3);
    expect(accountBalance(data.accounts[1], transactions, "2025-01-31")).toBe(500);
  });
  test("empty and negative cash do not fabricate revenue or infinite runway", () => {
    expect(calculateMobileKpis([], [], 0, 0, "2025-01-31")).toMatchObject({ revenue: 0, currentCash: 0, cashRunwayDays: 0 });
    expect(calculateMobileKpis([], [], -10, 0, "2025-01-31").cashRunwayDays).toBe(0);
    expect(calculateMobileKpis([], [], 100, 0, "2025-01-31").cashRunwayDays).toBeNull();
  });
  test("historical as-of dates keep future records out of completed cash", () => {
    const future = transaction({ date: "2025-02-01", amount: 80 });
    expect(calculateMobileKpis([future], [], 0, 0, "2025-01-31")).toMatchObject({ revenue: 0, currentCash: 0, accountsReceivable: 80 });
    expect(calculateMobileKpis([future], [], 0, 0, "2025-02-01")).toMatchObject({ revenue: 80, currentCash: 80, accountsReceivable: 0 });
  });
  test("category and month totals reflect completed operating entries", () => {
    expect(calculateCategoryMix(transactions, "expense", "2025-01-31")).toEqual([{ category: "Rent", amount: 250, count: 1, sharePct: 100 }]);
    expect(monthlySummary(transactions, "2025-01-31")).toEqual([{ month: "2025-01", revenue: 30.3, expenses: 250, net: -219.7 }]);
  });
  test("ageing uses unpaid money at actual 30/60/90-day boundaries", () => {
    const rows = [0, 1, 30, 31, 60, 61, 90, 91].map((days, index) => invoice({ id: index, due_date: addDays("2025-05-01", -days), amount_paid: 25, amount_due: 75 }));
    expect(invoiceAgeing(rows, "2025-05-01").map((row) => row.amount)).toEqual([75, 150, 150, 150, 75]);
  });
  test("insufficient history forecasts only confirmed obligations", () => {
    const result = forecastLocal(data, BASE_SCENARIO, "2025-01-31");
    expect(result.historySufficient).toBe(false);
    expect(result.metrics).toEqual([]);
    expect(result.projectedRevenue).toBe(110);
    expect(result.projectedExpenses).toBe(20);
    expect(result.closingCash).toBe(870.3);
    expect(result.days[0]).toMatchObject({ date: "2025-02-01", inflows: 110, outflows: 20 });
  });
  test("one-time costs apply today and payment delays move obligations rather than resize them", () => {
    const result = forecastLocal(data, { ...BASE_SCENARIO, one_time_cost: 900, receivables_delay_days: 2, horizon_days: 3 }, "2025-01-31");
    expect(result.breachDate).toBe("2025-01-31");
    expect(result.projectedRevenue).toBe(110);
    expect(result.projectedExpenses).toBe(920);
    expect(result.days.map((row) => row.inflows)).toEqual([0, 0, 110]);
    expect(result.closingCash).toBe(-29.7);
    expect(result.minimumCash).toBe(-139.7);
  });
  test("old records outside the trailing 90 days do not qualify sparse history", () => {
    const old = Array.from({ length: 6 }, (_, index) => transaction({ id: index, date: addDays("2024-01-01", index) }));
    const result = forecastLocal(snapshot({ transactions: old }), BASE_SCENARIO, "2025-01-31");
    expect(result.historySufficient).toBe(false);
    expect(result.projectedRevenue).toBe(0);
  });
  test("real zero-revenue holdouts have no invented WAPE accuracy", () => {
    const early = Array.from({ length: 6 }, (_, index) => transaction({ id: index, date: addDays("2025-01-01", index) }));
    const result = forecastLocal(snapshot({ transactions: early }), BASE_SCENARIO, "2025-01-31");
    expect(result.historySufficient).toBe(true);
    expect(result.metrics).toHaveLength(3);
    expect(result.metrics.filter((row) => row.selected)).toHaveLength(1);
    expect(result.metrics.every((row) => row.wape === null)).toBe(true);
    expect(result.projectedRevenue).toBe(0);
  });
});

describe("financial input guards", () => {
  const data = snapshot({ accounts: [account(), account({ id: 2, name: "Cash" }), account({ id: 3, is_active: false })], invoices: [invoice()] });
  test("requires distinct owned active transfer accounts and rejects non-transfer destinations", () => {
    expect(() => validateTransaction(transaction({ kind: "transfer", account_id: 1, to_account_id: 1 }), data)).toThrow(/different accounts/);
    expect(() => validateTransaction(transaction({ account_id: 3 }), data)).toThrow(/active account/);
    expect(() => validateTransaction(transaction({ account_id: 99 }), data)).toThrow(/active account/);
    expect(() => validateTransaction(transaction({ to_account_id: 2 }), data)).toThrow(/only valid for transfers/);
    expect(validateTransaction(transaction({ kind: "transfer", account_id: 1, to_account_id: 2 }), data).kind).toBe("transfer");
  });
  test("rejects duplicate invoice numbers, bad dates, and currency conversion", () => {
    expect(() => validateInvoice(invoice({ invoice_number: "inv-11" }), data)).toThrow(/already exists/);
    expect(() => validateInvoice(invoice({ due_date: "2024-12-31" }), data, 11)).toThrow(/due date/);
    expect(() => validateInvoice(invoice({ currency: "EUR" }), data, 11)).toThrow(/currency/);
  });
  test("payments cannot overpay, use missing invoices, or settle in the future", () => {
    const payment = { invoice_id: 11, amount: 100, paid_on: "2025-01-31", payment_method: "Bank" };
    expect(validatePayment(payment, data).amount).toBe(100);
    expect(() => validatePayment({ ...payment, amount: 100.01 }, data)).toThrow(/outstanding amount/);
    expect(() => validatePayment({ ...payment, invoice_id: 99 }, data)).toThrow(/not found/);
    expect(() => validatePayment({ ...payment, paid_on: "2999-01-01" }, data)).toThrow(/future/);
  });
});
