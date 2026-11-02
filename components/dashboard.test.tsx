import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Dashboard from "./dashboard";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("FinSight sign in", () => {
  it("offers demo access and an account creation path", () => {
    render(<Dashboard />);
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Explore the demo workspace/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create an account" }));
    expect(screen.getByRole("heading", { name: "Create your workspace" })).toBeInTheDocument();
    expect(screen.getByLabelText("Business name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create account and workspace" })).toBeInTheDocument();
  });

  it("loads the authenticated workspace and opens accounts and invoices", async () => {
    localStorage.setItem("finsight-token", "test-token");
    localStorage.setItem("finsight-business", "1");
    const overview = {
      business: { id: 1, name: "Test business", currency: "INR", is_demo: false, opening_cash: "1000", minimum_reserve: "100" },
      period: { months: 6, start: "2026-06-01", end: "2026-11-02" },
      kpis: { revenue: 0, expenses: 0, net_cash_flow: 0, current_cash: 1000, profit_margin_pct: null, cash_margin_pct: 0, cash_runway_days: null, monthly_revenue_growth_pct: 0, monthly_expense_growth_pct: 0, expense_to_revenue_pct: 0, accounts_receivable: 0, accounts_payable: 0, working_capital: 1000, average_monthly_burn: 0 },
      monthly: [], expense_categories: [], recent_transactions: [], upcoming_obligations: [], insights: [],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const body = path === "/api/auth/me" ? { id: 1, name: "Test Owner", email: "test@example.com" }
        : path === "/api/businesses" ? [{ id: 1, name: "Test business", currency: "INR", opening_cash: "1000", minimum_reserve: "100", is_demo: false }]
        : path === "/api/analytics/overview" ? overview
        : path === "/api/accounts" ? []
        : path === "/api/invoices" ? { items: [], total: 0, page: 1, limit: 100, pages: 0 }
        : path === "/api/transactions" ? { items: [], total: 0, page: 1, limit: 100, pages: 0 }
        : [];
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<Dashboard />);
    fireEvent.click(await screen.findByRole("button", { name: "Accounts & invoices" }));
    expect(await screen.findByText("No accounts yet. Add one to track balances by bank, cash, card, or wallet.")).toBeInTheDocument();
    expect(screen.getByText("No invoices yet. Add a customer receivable or a supplier bill to start managing working capital.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/accounts"), expect.any(Object));
  });
});
