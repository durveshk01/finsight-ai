"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Activity, ArrowDownRight, ArrowUpRight, Bell, BriefcaseBusiness, CalendarDays,
  Check, ChevronDown, CircleDollarSign, Clock3, Download, FileText, Gauge,
  LayoutDashboard, Lightbulb, LogOut, Menu, Moon, MoreHorizontal, Pencil,
  Plus, Search, Settings, ShieldAlert, SlidersHorizontal, Sparkles, Sun,
  Trash2, Upload, Wallet, X, ChevronLeft, ChevronRight, type LucideIcon,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend,
  Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Button, CardTitle, Field, inputClass } from "@/components/ui";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const categories = ["Sales Revenue", "Service Revenue", "Interest Income", "Investment Income", "Other Income", "Salaries", "Rent", "Utilities", "Marketing", "Inventory", "Transportation", "Software Subscriptions", "Taxes", "Loan Repayments", "Maintenance", "Other Expenses"];
const navSections: { title: string; items: { id: string; label: string; icon: LucideIcon }[] }[] = [
  { title: "WORKSPACE", items: [{ id: "overview", label: "Overview", icon: LayoutDashboard }, { id: "transactions", label: "Transactions", icon: CircleDollarSign }, { id: "revenue", label: "Revenue analytics", icon: Activity }, { id: "expenses", label: "Expense analytics", icon: SlidersHorizontal }, { id: "cashflow", label: "Cash flow", icon: Wallet }] },
  { title: "INTELLIGENCE", items: [{ id: "forecast", label: "AI forecasting", icon: Sparkles }, { id: "risk", label: "Risk analysis", icon: ShieldAlert }, { id: "simulator", label: "What-if simulator", icon: Gauge }, { id: "insights", label: "Business insights", icon: Lightbulb }] },
  { title: "MANAGE", items: [{ id: "accounts", label: "Accounts & invoices", icon: FileText }, { id: "recurring", label: "Recurring items", icon: CalendarDays }, { id: "reports", label: "Reports", icon: FileText }, { id: "notifications", label: "Notifications", icon: Bell }, { id: "settings", label: "Settings", icon: Settings }] },
];

type Business = { id: number; name: string; currency: string; opening_cash: string; minimum_reserve: string; is_demo: boolean };
type User = { id: number; name: string; email: string };
type Transaction = { id: number; kind: "income" | "expense"; category: string; amount: number; date: string; description: string; payment_method: string; status: string; reference?: string };
type Overview = { business: { id: number; name: string; currency: string; is_demo: boolean; opening_cash: string; minimum_reserve: string }; period: { months: number; start: string; end: string }; kpis: Record<string, number | null>; monthly: { month: string; revenue: number; expenses: number; net_cash_flow: number }[]; expense_categories: { category: string; amount: number; share_pct: number }[]; recent_transactions: Transaction[]; upcoming_obligations: Transaction[]; insights: Insight[] };
type Insight = { title: string; description: string; supporting_figures: Record<string, unknown>; period: string; severity: string; recommended_action: string; reference: string };
type Forecast = { selected_model: string; status?: string; training_start: string | null; training_end: string | null; metrics: { model: string; mae: number; rmse: number; mape: number | null; wape: number | null; selected: boolean }[]; predictions: { date: string; value: number; lower: number; upper: number }[] };
type CashDay = { date: string; inflows: number; outflows: number; balance: number; lower_balance: number; upper_balance: number };
type Cashflow = { opening_balance: number; minimum_reserve: number; minimum_expected_balance: number; shortfall: { date: string; amount_below_reserve: number } | null; days: CashDay[]; revenue_model: string; expense_model: string; confirmed_obligations: number; recurring_occurrences: number };
type Scenario = { id?: number; name: string; assumptions?: Record<string, number>; monthly_revenue?: number; monthly_expenses?: number; monthly_net_cash_flow?: number; closing_cash?: number; cash_runway_days?: number | null; risk?: string; horizon_months?: number };
type ImportField = "date" | "amount" | "kind" | "category" | "description";
type ImportPreview = { rows: Record<string, unknown>[]; errors: { line: number; error: string }[]; valid_count: number; invalid_count: number; columns: string[]; mapping: Partial<Record<ImportField, string | null>> };
type ImportResult = { imported: number; duplicates: number; errors: { row: number; error: string }[] };
type RiskSnapshot = { score: number; category: string; indicators: { cash_coverage_months: number; cash_margin_pct: number; reserve_breach: { date: string; amount_below_reserve: number } | null; monthly_revenue_growth_pct: number }; deductions: Record<string, number>; methodology: string };
type Recurring = { id: number; kind: "income" | "expense"; category: string; amount: number; frequency: "weekly" | "monthly" | "quarterly"; next_date: string; end_date: string | null; description: string; payment_method: string; enabled: boolean };
type ScenarioInput = { revenue_change_pct: number; expense_change_pct: number; one_time_cost: number; new_monthly_revenue: number; marketing_reduction_pct: number; salary_increase_pct: number; inventory_increase_pct: number; new_hire_monthly_cost: number; campaign_monthly_cost: number; additional_loan_payment: number; loan_proceeds: number; capital_investment: number; horizon_months: number };
type ReportRecord = { id: number; report_type: string; format: string; period_months: number; file_name: string; generated_at: string | null };
type Account = { id: number; name: string; account_type: string; currency: string; opening_balance: number; current_balance: number; is_active: boolean };
type Invoice = { id: number; direction: "receivable" | "payable"; invoice_number: string; counterparty: string; issue_date: string; due_date: string; amount: number; amount_paid: number; amount_due: number; currency: string; category: string; account_id: number | null; status: string; description: string };
type WorkspaceMember = { id: number; user_id: number; name: string; email: string; role: "owner" | "admin" | "accountant" | "viewer" };

const transactionSchema = z.object({
  kind: z.enum(["income", "expense"]), category: z.string().min(2, "Choose a category"),
  amount: z.coerce.number().positive("Enter an amount greater than zero"), date: z.string().min(1),
  description: z.string().max(240), payment_method: z.string().min(1), status: z.enum(["completed", "pending", "scheduled"]),
});
type TransactionForm = z.infer<typeof transactionSchema>;

function currency(value: number | null | undefined, code = "INR", compact = false) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: code, maximumFractionDigits: compact ? 0 : 2, notation: compact && Math.abs(amount) >= 100000 ? "compact" : "standard" }).format(Number.isFinite(amount) ? amount : 0);
}
function fmtDate(value?: string) { return value ? new Date(value + (value.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"; }
function monthLabel(value: string) { return new Date(value + "-01T00:00:00").toLocaleDateString("en-IN", { month: "short", year: "2-digit" }); }
function messageFrom(error: unknown) { return error instanceof Error ? error.message : "Something went wrong. Try again."; }

async function readResponse(response: Response) {
  if (!response.ok) {
    let detail = "Request failed";
    try { const body = await response.json(); detail = body.detail ?? detail; } catch { /* response may not be JSON */ }
    throw new Error(detail);
  }
  return response.json();
}

export default function Dashboard() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState<number | null>(null);
  const [active, setActive] = useState("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionTotal, setTransactionTotal] = useState(0);
  const [transactionPage, setTransactionPage] = useState(1);
  const [transactionPages, setTransactionPages] = useState(1);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [sort, setSort] = useState("date");
  const [direction, setDirection] = useState("desc");
  const [recurringItems, setRecurringItems] = useState<Recurring[]>([]);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [expenseForecasts, setExpenseForecasts] = useState<{ category: string; forecast_total: number; model: string }[]>([]);
  const [cashflow, setCashflow] = useState<Cashflow | null>(null);
  const [riskSnapshot, setRiskSnapshot] = useState<RiskSnapshot | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [notifications, setNotifications] = useState<{ id: number; title: string; message: string; severity: string; is_read: boolean; created_at: string }[]>([]);
  const [revenueSeries, setRevenueSeries] = useState<{ month: string; revenue: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState(6);
  const [horizon, setHorizon] = useState(90);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [theme, setTheme] = useState("light");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [scenarioInput, setScenarioInput] = useState<ScenarioInput>({ revenue_change_pct: 10, expense_change_pct: 0, one_time_cost: 0, new_monthly_revenue: 0, marketing_reduction_pct: 0, salary_increase_pct: 0, inventory_increase_pct: 0, new_hire_monthly_cost: 0, campaign_monthly_cost: 0, additional_loan_payment: 0, loan_proceeds: 0, capital_investment: 0, horizon_months: 6 });
  const [scenarioResult, setScenarioResult] = useState<Scenario | null>(null);
  const [settingsForm, setSettingsForm] = useState({ name: "", currency: "INR", minimum_reserve: "", opening_cash: "" });

  const business = businesses.find((item) => item.id === businessId) ?? businesses[0];
  const code = business?.currency ?? "INR";
  const unread = notifications.filter((item) => !item.is_read).length;
  const api = useCallback(async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (businessId) headers.set("X-Business-Id", String(businessId));
    if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
    return readResponse(await fetch(`${API}${path}`, { ...init, headers }));
  }, [token, businessId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const savedToken = localStorage.getItem("finsight-token");
      const savedBusiness = Number(localStorage.getItem("finsight-business") || 0);
      const savedTheme = localStorage.getItem("finsight-theme") ?? "light";
      setTheme(savedTheme);
      document.documentElement.classList.toggle("dark", savedTheme === "dark");
      if (savedToken) {
        setToken(savedToken);
        if (savedBusiness) setBusinessId(savedBusiness);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const loadWorkspace = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError("");
    try {
      const [me, workspaces] = await Promise.all([api("/api/auth/me"), api("/api/businesses")]);
      const records = workspaces as Business[];
      setUser(me as User); setBusinesses(records);
      const selected = records.find((item) => item.id === businessId) ?? records[0];
      if (selected && selected.id !== businessId) setBusinessId(selected.id);
      if (!selected) { setError("Your account does not have a business workspace yet."); return; }
    } catch (e) { setError(messageFrom(e)); setToken(""); localStorage.removeItem("finsight-token"); }
    finally { setLoading(false); }
  }, [api, businessId, token]);

  useEffect(() => { const timer = window.setTimeout(() => { void loadWorkspace(); }, 0); return () => window.clearTimeout(timer); }, [loadWorkspace]);

  const loadOverview = useCallback(async () => {
    if (!token || !businessId) return;
    setLoading(true); setError("");
    try {
      const result = await api(`/api/analytics/overview?months=${period}`) as Overview;
      setOverview(result);
      setInsights(result.insights ?? []);
      setSettingsForm({ name: result.business.name, currency: result.business.currency, minimum_reserve: result.business.minimum_reserve, opening_cash: result.business.opening_cash });
    } catch (e) { setError(messageFrom(e)); }
    finally { setLoading(false); }
  }, [api, businessId, period, token]);

  useEffect(() => { const timer = window.setTimeout(() => { void loadOverview(); }, 0); return () => window.clearTimeout(timer); }, [loadOverview]);

  const loadTransactions = useCallback(async () => {
    if (!token || !businessId) return;
    const params = new URLSearchParams({ page: String(transactionPage), limit: "100", sort, direction });
    if (search.trim()) params.set("search", search.trim());
    if (kindFilter) params.set("kind", kindFilter);
    if (categoryFilter) params.set("category", categoryFilter);
    if (dateStart) params.set("start", dateStart);
    if (dateEnd) params.set("end", dateEnd);
    try { const result = await api(`/api/transactions?${params}`) as { items: Transaction[]; total: number; pages: number }; setTransactions(result.items); setTransactionTotal(result.total); setTransactionPages(result.pages); }
    catch (e) { setError(messageFrom(e)); }
  }, [api, businessId, categoryFilter, dateEnd, dateStart, direction, kindFilter, search, sort, token, transactionPage]);

  useEffect(() => { if (active !== "transactions" && active !== "overview") return; const timer = window.setTimeout(() => { void loadTransactions(); }, 0); return () => window.clearTimeout(timer); }, [active, loadTransactions]);

  const loadNotifications = useCallback(async () => {
    if (!token || !businessId) return;
    try { setNotifications(await api("/api/notifications") as typeof notifications); } catch (e) { setError(messageFrom(e)); }
  }, [api, businessId, token]);

  useEffect(() => {
    if (!token || !businessId) return;
    const load = async () => {
      try {
        if (active === "notifications") await loadNotifications();
        if (active === "recurring") setRecurringItems(await api("/api/recurring") as Recurring[]);
        if (active === "insights") setInsights(await api("/api/insights") as Insight[]);
        if (active === "revenue") {
          const [series, prediction] = await Promise.all([api("/api/analytics/revenue?months=12"), api(`/api/forecasts/revenue?horizon=${horizon}`)]);
          setRevenueSeries((series as { series: { month: string; revenue: number }[] }).series); setForecast(prediction as Forecast);
        }
        if (active === "expenses") {
          const forecastResult = await api(`/api/forecasts/expenses/categories?horizon=${horizon}`) as { categories: { category: string; forecast_total: number; model: string }[] };
          setExpenseForecasts(forecastResult.categories);
        }
        if (active === "cashflow") setCashflow(await api(`/api/analytics/cash-flow?horizon=${horizon}`) as Cashflow);
        if (active === "risk") setRiskSnapshot(await api("/api/risk") as RiskSnapshot);
        if (active === "simulator") {
          const result = await api("/api/scenarios/compare") as { scenarios: Scenario[] }; setScenarios(result.scenarios);
        }
      } catch (e) { setError(messageFrom(e)); }
    };
    void load();
  }, [active, api, businessId, horizon, loadNotifications, token]);

  const handleLogin = async (email: string, password: string) => {
    setLoading(true); setError("");
    try {
      const result = await readResponse(await fetch(`${API}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })) as { access_token: string; user: User; businesses: Business[] };
      setToken(result.access_token); setUser(result.user); setBusinesses(result.businesses);
      localStorage.setItem("finsight-token", result.access_token);
      const first = result.businesses[0];
      if (first) { setBusinessId(first.id); localStorage.setItem("finsight-business", String(first.id)); }
    } catch (e) { setError(messageFrom(e)); }
    finally { setLoading(false); }
  };

  const handleRegister = async (name: string, email: string, password: string, businessName: string, currencyCode: string) => {
    setLoading(true); setError("");
    try {
      const response = await readResponse(await fetch(`${API}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email, password, business_name: businessName, currency: currencyCode }) })) as { access_token: string; user: User; business: Business };
      setToken(response.access_token); setUser(response.user); setBusinesses([response.business]); setBusinessId(response.business.id);
      localStorage.setItem("finsight-token", response.access_token); localStorage.setItem("finsight-business", String(response.business.id));
    } catch (e) { setError(messageFrom(e)); }
    finally { setLoading(false); }
  };

  const logout = () => { setToken(""); setUser(null); setOverview(null); localStorage.removeItem("finsight-token"); };
  const selectBusiness = (id: number) => { setBusinessId(id); localStorage.setItem("finsight-business", String(id)); setActive("overview"); };
  const toggleTheme = () => { const value = theme === "light" ? "dark" : "light"; setTheme(value); localStorage.setItem("finsight-theme", value); document.documentElement.classList.toggle("dark", value === "dark"); };
  const refreshAll = async () => { await loadOverview(); await loadTransactions(); };
  const startAdd = () => { setEditing(null); setModalOpen(true); };
  const startEdit = (row: Transaction) => { setEditing(row.id); setModalOpen(true); };
  const deleteTransaction = async (id: number) => {
    if (!window.confirm("Delete this transaction? Its amount will be removed from your financial totals.")) return;
    try { await api(`/api/transactions/${id}`, { method: "DELETE" }); await refreshAll(); }
    catch (e) { setError(messageFrom(e)); }
  };

  const activeTitle = navSections.flatMap((section) => section.items).find((item) => item.id === active)?.label ?? "Overview";

  if (!token) return <LoginScreen onLogin={handleLogin} onRegister={handleRegister} loading={loading} error={error} />;

  return <div className={`min-h-screen bg-[var(--background)] text-[var(--foreground)] ${theme === "dark" ? "dark" : ""}`}>
    {mobileMenu && <button aria-label="Close navigation" onClick={() => setMobileMenu(false)} className="fixed inset-0 z-30 bg-black/30 lg:hidden" />}
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[258px] flex-col border-r border-[var(--line)] bg-[var(--surface)] transition-transform lg:translate-x-0 ${mobileMenu ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex h-[76px] items-center gap-3 border-b border-[var(--line)] px-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#e8f4ed] text-[#147354]"><Activity size={19} strokeWidth={2.5} /></div>
        <div><div className="text-[15px] font-bold tracking-[-.04em]">FinSight<span className="text-[#187a57]"> AI</span></div><div className="text-[10px] font-medium uppercase tracking-[.16em] text-[var(--muted)]">Financial intelligence</div></div>
        <button className="ml-auto text-[var(--muted)] lg:hidden" onClick={() => setMobileMenu(false)} aria-label="Close menu"><X size={18} /></button>
      </div>
      <div className="border-b border-[var(--line)] p-4">
        <label className="mb-2 block px-2 text-[10px] font-semibold tracking-[.14em] text-[var(--muted)]">WORKSPACE</label>
        <div className="relative">
          <BriefcaseBusiness size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          <select value={business?.id ?? ""} onChange={(e) => selectBusiness(Number(e.target.value))} className="w-full appearance-none rounded-lg border border-[var(--line)] bg-[var(--background)] py-2.5 pl-9 pr-8 text-xs font-semibold outline-none focus:border-[#66a787]">
            {businesses.map((item) => <option key={item.id} value={item.id}>{item.name}{item.is_demo ? " · Demo" : ""}</option>)}
          </select><ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
        </div>
      </div>
      <nav className="thin-scrollbar flex-1 overflow-y-auto px-3 py-5">
        {navSections.map((section) => <div key={section.title} className="mb-7">
          <div className="mb-2 px-3 text-[10px] font-bold tracking-[.14em] text-[#9aa79f]">{section.title}</div>
          <div className="grid gap-1">{section.items.map((item) => { const Icon = item.icon; const selected = item.id === active; return <button key={item.id} onClick={() => { setActive(item.id); setMobileMenu(false); setError(""); }} className={`flex h-10 items-center gap-3 rounded-lg px-3 text-left text-[13px] font-medium transition ${selected ? "bg-[#edf6f0] text-[#146747] dark:bg-[#233b2e] dark:text-[#a5d3b5]" : "text-[#67756d] hover:bg-[var(--background)] hover:text-[var(--foreground)]"}`}><Icon size={17} strokeWidth={selected ? 2.2 : 1.8} />{item.label}{item.id === "notifications" && unread > 0 && <span className="ml-auto rounded-full bg-[#e95145] px-1.5 py-0.5 text-[10px] font-bold text-white">{unread}</span>}</button>; })}</div>
        </div>)}
      </nav>
      {business?.is_demo && <div className="mx-4 mb-3 rounded-xl border border-[#dbece1] bg-[#f3faf5] p-3 dark:bg-[#1e3227]"><div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#347456]"><Sparkles size={13} /> Sample workspace</div><p className="mt-1.5 text-[10px] leading-4 text-[#6d8175]">Synthetic demo activity. Your own records stay separate in your workspace.</p></div>}
      <div className="border-t border-[var(--line)] p-4">
        <div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#e9edf9] text-xs font-bold text-[#5265a4]">{(user?.name ?? "U").split(" ").map((v) => v[0]).join("").slice(0, 2).toUpperCase()}</div><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{user?.name}</div><div className="truncate text-[10px] text-[var(--muted)]">{user?.email}</div></div><button onClick={logout} title="Sign out" className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--background)]"><LogOut size={15} /></button></div>
      </div>
    </aside>

    <div className="min-h-screen lg:pl-[258px]">
      <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-[var(--line)] bg-[var(--surface)]/95 px-4 backdrop-blur sm:px-7 lg:px-9">
        <div className="flex items-center gap-3"><button onClick={() => setMobileMenu(true)} className="rounded-md p-1.5 text-[var(--muted)] lg:hidden" aria-label="Open navigation"><Menu size={19} /></button><div><div className="text-[15px] font-semibold tracking-[-.02em]">{activeTitle}</div><div className="mt-0.5 text-[11px] text-[var(--muted)]">{business?.name ?? "Your workspace"} <span className="px-1">·</span>{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</div></div></div>
        <div className="flex items-center gap-2 sm:gap-3">
          {active === "overview" && <select value={period} onChange={(e) => setPeriod(Number(e.target.value))} aria-label="Reporting period" className="hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-2 text-xs font-medium sm:block"><option value={3}>Last 3 months</option><option value={6}>Last 6 months</option><option value={12}>Last 12 months</option><option value={24}>Last 24 months</option></select>}
          <button onClick={toggleTheme} title="Toggle theme" className="rounded-lg border border-[var(--line)] p-2 text-[var(--muted)] hover:bg-[var(--background)]">{theme === "light" ? <Moon size={16} /> : <Sun size={16} />}</button>
          <button onClick={() => { setActive("notifications"); void loadNotifications(); }} aria-label="Notifications" className="relative rounded-lg border border-[var(--line)] p-2 text-[var(--muted)] hover:bg-[var(--background)]"><Bell size={16} />{unread > 0 && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-[var(--surface)] bg-[#e95145]" />}</button>
          <Button onClick={startAdd} className="hidden sm:inline-flex"><Plus size={15} />Add transaction</Button>
        </div>
      </header>

      <main className="mx-auto max-w-[1510px] px-4 py-6 sm:px-7 sm:py-8 lg:px-9">
        {error && <div role="alert" className="mb-5 flex items-start gap-2 rounded-lg border border-[#f3ccc7] bg-[#fff3f1] px-4 py-3 text-[13px] text-[#a44237]"><ShieldAlert size={16} className="mt-0.5 shrink-0" />{error}<button className="ml-auto" onClick={() => setError("")} aria-label="Dismiss error"><X size={15} /></button></div>}
        {loading && !overview && <div className="mb-5 flex items-center gap-2 text-xs text-[var(--muted)]"><span className="h-2 w-2 animate-pulse rounded-full bg-[#147354]" />Loading your financial workspace…</div>}
        {active === "overview" && <OverviewPage overview={overview} loading={loading} transactions={transactions.slice(0, 5)} code={code} onNavigate={setActive} onAdd={startAdd} />}
        {active === "transactions" && <TransactionsPage rows={transactions} total={transactionTotal} page={transactionPage} pages={transactionPages} setPage={setTransactionPage} search={search} setSearch={(v) => { setSearch(v); setTransactionPage(1); }} kindFilter={kindFilter} setKindFilter={(v) => { setKindFilter(v); setTransactionPage(1); }} categoryFilter={categoryFilter} setCategoryFilter={(v) => { setCategoryFilter(v); setTransactionPage(1); }} dateStart={dateStart} setDateStart={(v) => { setDateStart(v); setTransactionPage(1); }} dateEnd={dateEnd} setDateEnd={(v) => { setDateEnd(v); setTransactionPage(1); }} sort={sort} setSort={(v) => { setSort(v); setTransactionPage(1); }} direction={direction} setDirection={(v) => { setDirection(v); setTransactionPage(1); }} onAdd={startAdd} onEdit={startEdit} onDelete={deleteTransaction} onUpload={async (file) => { const form = new FormData(); form.append("file", file); try { setImportPreview(await api("/api/transactions/import/preview", { method: "POST", body: form }) as ImportPreview); } catch (e) { setError(messageFrom(e)); } }} onRemap={async (file, mapping) => { const form = new FormData(); form.append("file", file); form.append("mapping", JSON.stringify(mapping)); try { setImportPreview(await api("/api/transactions/import/preview", { method: "POST", body: form }) as ImportPreview); } catch (e) { setError(messageFrom(e)); } }} importPreview={importPreview} setImportPreview={setImportPreview} confirmImport={async () => { if (!importPreview) return null; try { const result = await api("/api/transactions/import/confirm", { method: "POST", body: JSON.stringify({ rows: importPreview.rows }) }) as ImportResult; setImportPreview(null); await Promise.all([loadTransactions(), loadOverview()]); return result; } catch (e) { setError(messageFrom(e)); return null; } }} code={code} />}
        {active === "revenue" && <RevenuePage series={revenueSeries} forecast={forecast} horizon={horizon} setHorizon={setHorizon} code={code} />}
        {active === "expenses" && <ExpensesPage overview={overview} forecasts={expenseForecasts} horizon={horizon} setHorizon={setHorizon} code={code} />}
        {active === "cashflow" && <CashflowPage cashflow={cashflow} horizon={horizon} setHorizon={setHorizon} code={code} />}
        {active === "forecast" && <ForecastPage forecast={forecast} setForecast={setForecast} horizon={horizon} setHorizon={setHorizon} code={code} api={api} />}
        {active === "risk" && <RiskPage risk={riskSnapshot} />}
        {active === "simulator" && <SimulatorPage input={scenarioInput} setInput={setScenarioInput} scenarios={scenarios} result={scenarioResult} setResult={setScenarioResult} code={code} api={api} onRefresh={async () => { const result = await api("/api/scenarios/compare") as { scenarios: Scenario[] }; setScenarios(result.scenarios); }} />}
        {active === "insights" && <InsightsPage insights={insights} onGenerate={async () => { try { const result = await api("/api/insights/generate", { method: "POST" }) as { insights: Insight[] }; setInsights(result.insights); await loadNotifications(); } catch (e) { setError(messageFrom(e)); } }} />}
        {active === "accounts" && <AccountsInvoicesPage code={code} api={api} onRefresh={() => { void loadOverview(); }} />}
        {active === "recurring" && <RecurringPage items={recurringItems} setItems={setRecurringItems} code={code} api={api} />}
        {active === "reports" && <ReportsPage code={code} api={api} />}
        {active === "notifications" && <NotificationsPage items={notifications} onRefresh={loadNotifications} onRead={async (id) => { try { await api(`/api/notifications/${id}/read`, { method: "PATCH" }); await loadNotifications(); } catch (e) { setError(messageFrom(e)); } }} />}
        {active === "settings" && <SettingsPage form={settingsForm} setForm={setSettingsForm} code={code} api={api} onSaved={async () => { await loadWorkspace(); await loadOverview(); }} />}
      </main>
      <footer className="mx-auto flex max-w-[1510px] items-center justify-between px-4 pb-6 text-[10px] text-[var(--muted)] sm:px-7 lg:px-9"><span>FinSight AI · Financial intelligence for growing businesses</span><span>Forecasts are estimates based on available transaction history</span></footer>
    </div>

    <TransactionModal open={modalOpen} onClose={() => setModalOpen(false)} editingId={editing} rows={transactions} api={api} onSaved={async () => { setModalOpen(false); await refreshAll(); }} onError={setError} />
    <div className="fixed bottom-5 right-5 z-10 sm:hidden"><Button onClick={startAdd} className="h-12 w-12 rounded-full p-0 shadow-lg" aria-label="Add transaction"><Plus size={21} /></Button></div>
  </div>;
}

function LoginScreen({ onLogin, onRegister, loading, error }: { onLogin: (email: string, password: string) => void; onRegister: (name: string, email: string, password: string, businessName: string, currency: string) => void; loading: boolean; error: string }) {
  const [email, setEmail] = useState("demo@finsight.ai");
  const [password, setPassword] = useState("Demo1234!");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [currencyCode, setCurrencyCode] = useState("INR");
  return <div className="grid min-h-screen bg-[#f5f8f6] lg:grid-cols-[1.05fr_.95fr]">
    <div className="relative hidden overflow-hidden bg-[#102b22] p-12 text-white lg:flex lg:flex-col lg:justify-between xl:p-16">
      <div className="absolute -right-28 -top-32 h-[470px] w-[470px] rounded-full border border-white/10" /><div className="absolute -right-6 -top-10 h-[340px] w-[340px] rounded-full border border-white/10" />
      <div className="relative flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#d9f2e3] text-[#147354]"><Activity size={20} /></div><span className="text-lg font-bold tracking-tight">FinSight <span className="text-[#78c69f]">AI</span></span></div>
      <div className="relative max-w-xl"><div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-[#b4d8c3]"><Sparkles size={13} />Financial clarity for what’s next</div><h1 className="text-5xl font-semibold leading-[1.12] tracking-[-.055em] xl:text-[58px]">See your cash flow.<br /><span className="text-[#8fd1a8]">Shape what comes next.</span></h1><p className="mt-6 max-w-md text-[15px] leading-7 text-[#b5c9bd]">Bring your financial activity together, spot risks early, and make the next business decision with confidence.</p>
        <div className="mt-12 grid max-w-lg grid-cols-3 gap-3">{[{ label: "Cash runway", value: "Know your horizon" }, { label: "Forecasts", value: "Plan with context" }, { label: "Scenarios", value: "Explore options" }].map((item) => <div key={item.label} className="rounded-xl border border-white/10 bg-white/5 p-3.5"><div className="text-[10px] uppercase tracking-wider text-[#99b9a7]">{item.label}</div><div className="mt-1.5 text-xs font-semibold">{item.value}</div></div>)}</div>
      </div><div className="relative text-[11px] text-[#7e9b89]">Your decisions, backed by your numbers.</div>
    </div>
    <div className="flex min-h-screen items-center justify-center p-5 sm:p-10">
      <div className="w-full max-w-[400px]"><div className="mb-9 flex items-center gap-3 lg:hidden"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#e4f3e9] text-[#147354]"><Activity size={19} /></div><span className="font-bold">FinSight <span className="text-[#147354]">AI</span></span></div>
        <div className="mb-8"><div className="mb-3 inline-flex rounded-full bg-[#eaf5ee] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.1em] text-[#367456]">Business workspace</div><h2 className="text-[28px] font-semibold tracking-[-.04em] text-[#17251d]">{creating ? "Create your workspace" : "Welcome back"}</h2><p className="mt-2 text-sm leading-6 text-[#738078]">{creating ? "Set up your account to start tracking business cash flow." : "Sign in to review your business performance and plan ahead."}</p></div>
        {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">{error}</div>}
        <form onSubmit={(event) => { event.preventDefault(); if (creating) onRegister(name, email, password, businessName, currencyCode); else onLogin(email, password); }} className="grid gap-4">
          {creating && <><Field label="Your name"><input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} required minLength={2} autoComplete="name" /></Field><Field label="Business name"><input value={businessName} onChange={(e) => setBusinessName(e.target.value)} className={inputClass} required minLength={2} /></Field></>}
          <Field label="Email address"><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} required /></Field>
          <Field label="Password"><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} required minLength={8} /></Field>
          {creating && <Field label="Business currency"><select className={inputClass} value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)}>{["INR", "USD", "EUR", "GBP", "CAD", "AUD", "SGD", "AED"].map((v) => <option key={v}>{v}</option>)}</select></Field>}
          <Button type="submit" disabled={loading} className="mt-2 h-11 w-full">{loading ? "Please wait…" : creating ? "Create account and workspace" : "Sign in"}</Button>
        </form>
        {!creating && <><div className="my-6 flex items-center gap-3 text-[10px] text-[#a2ada6]"><span className="h-px flex-1 bg-[#e7ece9]" />OR<span className="h-px flex-1 bg-[#e7ece9]" /></div><button onClick={() => { setEmail("demo@finsight.ai"); setPassword("Demo1234!"); onLogin("demo@finsight.ai", "Demo1234!"); }} disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#dce7df] bg-white px-4 py-3 text-[13px] font-semibold text-[#426c53] transition hover:bg-[#f6faf7] disabled:opacity-50"><Sparkles size={15} />Explore the demo workspace</button></>}
        <p className="mt-6 text-center text-[11px] leading-5 text-[#849188]">{creating ? "Already have a workspace?" : "New to FinSight?"} <button className="font-semibold text-[#28714f] hover:underline" onClick={() => { setCreating(!creating); setEmail(creating ? "demo@finsight.ai" : ""); setPassword(""); }}>{creating ? "Sign in" : "Create an account"}</button></p>
      </div>
    </div>
  </div>;
}

function OverviewPage({ overview, loading, transactions, code, onNavigate, onAdd }: { overview: Overview | null; loading: boolean; transactions: Transaction[]; code: string; onNavigate: (id: string) => void; onAdd: () => void }) {
  if (!overview && loading) return <LoadingCards />;
  if (!overview) return <EmptyState title="Your dashboard is getting ready" subtitle="Add a transaction or refresh to load your business summary." />;
  const k = overview.kpis;
  const cards = [
    { label: "Total revenue", value: k.revenue, note: `${Number(k.monthly_revenue_growth_pct ?? 0) >= 0 ? "+" : ""}${Number(k.monthly_revenue_growth_pct ?? 0).toFixed(1)}% vs last month`, positive: Number(k.monthly_revenue_growth_pct ?? 0) >= 0, icon: ArrowUpRight },
    { label: "Total expenses", value: k.expenses, note: `${Number(k.monthly_expense_growth_pct ?? 0) >= 0 ? "+" : ""}${Number(k.monthly_expense_growth_pct ?? 0).toFixed(1)}% vs last month`, positive: Number(k.monthly_expense_growth_pct ?? 0) <= 0, icon: ArrowDownRight },
    { label: "Net cash flow", value: k.net_cash_flow, note: Number(k.net_cash_flow ?? 0) >= 0 ? "Positive across this period" : "Outflows exceeded inflows", positive: Number(k.net_cash_flow ?? 0) >= 0, icon: Activity },
    { label: "Current cash", value: k.current_cash, note: `Reserve ${currency(Number(overview.business.minimum_reserve), code, true)}`, positive: true, icon: Wallet },
    { label: "Net cash margin", value: `${Number(k.cash_margin_pct ?? 0).toFixed(1)}%`, note: "Net cash flow ÷ revenue · cash basis", positive: Number(k.cash_margin_pct ?? 0) >= 0, icon: Gauge, raw: true },
    { label: "Cash runway", value: k.cash_runway_days == null ? "Healthy" : `${Math.round(Number(k.cash_runway_days))} days`, note: "At recent net burn rate", positive: k.cash_runway_days == null || Number(k.cash_runway_days) > 60, icon: Clock3, raw: true },
  ];
  return <div className="grid gap-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><div className="text-xs text-[var(--muted)]">{overview.period.start ? `${fmtDate(overview.period.start)} — ${fmtDate(overview.period.end)}` : "Current reporting period"}</div><h1 className="mt-1 text-[22px] font-semibold tracking-[-.04em]">Good morning, {overview.business.name}</h1><p className="mt-1 text-xs text-[var(--muted)]">Here’s how your business is doing at a glance.</p></div><div className="flex gap-2"><Button variant="secondary" onClick={() => onNavigate("reports")}><Download size={14} />Export report</Button><Button onClick={onAdd}><Plus size={15} />Add transaction</Button></div></div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">{cards.map((item) => <KpiCard key={item.label} {...item} code={code} />)}</div>
    <div className="grid gap-5 xl:grid-cols-[1.65fr_1fr]">
      <div className="card soft-shadow p-5 sm:p-6"><CardTitle title="Revenue vs expenses" subtitle="Monthly completed activity" action={<button onClick={() => onNavigate("revenue")} className="text-xs font-semibold text-[#147354] hover:underline">View analytics</button>} />
        <div className="h-[270px]"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={overview.monthly} margin={{ left: -10, right: 8, top: 4, bottom: 0 }}><CartesianGrid vertical={false} strokeDasharray="3 4" /><XAxis dataKey="month" tickFormatter={monthLabel} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} /><YAxis tickFormatter={(v) => currency(Number(v), code, true)} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} width={63} /><Tooltip formatter={(value) => currency(Number(value), code)} labelFormatter={(label) => monthLabel(String(label))} contentStyle={tooltipStyle} /><Legend iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 12 }} /><Area dataKey="revenue" name="Revenue" fill="#dcefe5" stroke="#17805a" strokeWidth={2} fillOpacity={.7} activeDot={{ r: 4 }} /><Line dataKey="expenses" name="Expenses" stroke="#6382bb" strokeWidth={2} dot={false} activeDot={{ r: 4 }} /></ComposedChart></ResponsiveContainer></div>
      </div>
      <div className="card soft-shadow p-5 sm:p-6"><CardTitle title="Expense mix" subtitle="Share of spending in selected period" action={<button onClick={() => onNavigate("expenses")} className="text-xs font-semibold text-[#147354] hover:underline">Details</button>} />
        <div className="relative h-[210px]"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={overview.expense_categories.slice(0, 7)} dataKey="amount" nameKey="category" innerRadius={63} outerRadius={90} paddingAngle={3} stroke="none">{overview.expense_categories.slice(0, 7).map((_, i) => <Cell key={i} fill={["#167654", "#548c70", "#80ad8e", "#7398cb", "#9bb1d4", "#b4c9be", "#d3e0d8"][i]} />)}</Pie><Tooltip formatter={(value) => currency(Number(value), code)} contentStyle={tooltipStyle} /></PieChart></ResponsiveContainer><div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-[10px] text-[var(--muted)]">Total expenses</span><span className="mt-1 text-base font-semibold">{currency(Number(k.expenses), code, true)}</span></div></div>
        <div className="grid gap-2">{overview.expense_categories.slice(0, 4).map((item, i) => <div key={item.category} className="flex items-center gap-2 text-[11px]"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: ["#167654", "#548c70", "#80ad8e", "#7398cb"][i] }} /><span className="flex-1 text-[var(--muted)]">{item.category}</span><span className="font-semibold">{item.share_pct.toFixed(1)}%</span></div>)}</div>
      </div>
    </div>
    <div className="grid gap-5 xl:grid-cols-[1.25fr_1fr]">
      <div className="card soft-shadow p-5 sm:p-6"><CardTitle title="Financial insights" subtitle="Signals from your recorded financial activity" action={<button onClick={() => onNavigate("insights")} className="text-xs font-semibold text-[#147354] hover:underline">All insights</button>} />
        <div className="grid gap-3">{overview.insights.slice(0, 3).map((item, i) => <InsightRow item={item} key={`${item.title}-${i}`} />)}</div>
      </div>
      <div className="card soft-shadow p-5 sm:p-6"><CardTitle title="Upcoming obligations" subtitle="Scheduled and pending items" action={<button onClick={() => onNavigate("transactions")} className="text-xs font-semibold text-[#147354] hover:underline">View all</button>} />
        {overview.upcoming_obligations.length ? <div className="grid gap-1">{overview.upcoming_obligations.slice(0, 4).map((item) => <div key={item.id} className="flex items-center gap-3 border-b border-[var(--line)] py-2.5 last:border-0"><div className={`flex h-8 w-8 items-center justify-center rounded-lg ${item.kind === "income" ? "bg-[#eaf5ee] text-[#167653]" : "bg-[#f0f3f9] text-[#5872a4]"}`}>{item.kind === "income" ? <ArrowDownRight size={15} /> : <CalendarDays size={15} />}</div><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{item.description || item.category}</div><div className="mt-0.5 text-[10px] text-[var(--muted)]">{item.category} · due {fmtDate(item.date)}</div></div><div className={`text-xs font-semibold ${item.kind === "income" ? "text-[#167653]" : "text-[var(--foreground)]"}`}>{item.kind === "income" ? "+" : "−"}{currency(item.amount, code, true)}</div></div>)}</div> : <EmptyState title="Nothing scheduled" subtitle="Add upcoming payments and expected receipts to include them in cash projections." compact />}
      </div>
    </div>
    <div className="card soft-shadow overflow-hidden"><div className="flex items-center justify-between px-5 pt-5 sm:px-6"><CardTitle title="Recent transactions" subtitle="Latest completed activity" /><button onClick={() => onNavigate("transactions")} className="mb-5 text-xs font-semibold text-[#147354] hover:underline">View transactions</button></div><TransactionTable rows={transactions} code={code} compact /></div>
  </div>;
}

function KpiCard({ label, value, note, positive, icon: Icon, raw, code = "INR" }: { label: string; value: number | string | null | undefined; note: string; positive: boolean; icon: LucideIcon; raw?: boolean; code?: string }) {
  return <div className="card soft-shadow p-4"><div className="flex items-center justify-between"><span className="text-[11px] font-medium text-[var(--muted)]">{label}</span><span className={`flex h-7 w-7 items-center justify-center rounded-lg ${positive ? "bg-[#ebf5ef] text-[#187653]" : "bg-[#fff0ee] text-[#c2483e]"}`}><Icon size={14} /></span></div><div className="mt-3 text-[20px] font-semibold tracking-[-.035em]">{raw ? value ?? "—" : currency(Number(value ?? 0), code, true)}</div><div className={`mt-1.5 text-[10px] ${positive ? "text-[#428368]" : "text-[#bc554b]"}`}>{note}</div></div>;
}

function TransactionsPage({ rows, total, page, pages, setPage, search, setSearch, kindFilter, setKindFilter, categoryFilter, setCategoryFilter, dateStart, setDateStart, dateEnd, setDateEnd, sort, setSort, direction, setDirection, onAdd, onEdit, onDelete, onUpload, onRemap, importPreview, setImportPreview, confirmImport, code }: { rows: Transaction[]; total: number; page: number; pages: number; setPage: (v: number) => void; search: string; setSearch: (v: string) => void; kindFilter: string; setKindFilter: (v: string) => void; categoryFilter: string; setCategoryFilter: (v: string) => void; dateStart: string; setDateStart: (v: string) => void; dateEnd: string; setDateEnd: (v: string) => void; sort: string; setSort: (v: string) => void; direction: string; setDirection: (v: string) => void; onAdd: () => void; onEdit: (t: Transaction) => void; onDelete: (id: number) => void; onUpload: (f: File) => void; onRemap: (f: File, mapping: Partial<Record<ImportField, string | null>>) => void; importPreview: ImportPreview | null; setImportPreview: (v: ImportPreview | null) => void; confirmImport: () => Promise<ImportResult | null>; code: string }) {
  const [localSearch, setLocalSearch] = useState(search);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [columnMapping, setColumnMapping] = useState<Partial<Record<ImportField, string | null>>>({});
  const [importSummary, setImportSummary] = useState("");
  useEffect(() => { const timer = setTimeout(() => setSearch(localSearch), 250); return () => clearTimeout(timer); }, [localSearch, setSearch]);
  const importFields: { key: ImportField; label: string; required: boolean }[] = [{ key: "date", label: "Transaction date", required: true }, { key: "amount", label: "Amount", required: true }, { key: "kind", label: "Type", required: false }, { key: "category", label: "Category", required: false }, { key: "description", label: "Description", required: false }];
  const effectiveMapping = importPreview ? { ...importPreview.mapping, ...columnMapping } : {};
  return <div className="grid gap-5"><PageIntro title="Transactions" subtitle="Review and manage the activity behind your financial picture." action={<Button onClick={onAdd}><Plus size={15} />Add transaction</Button>} />
    <div className="card soft-shadow p-4 sm:p-5"><div className="flex flex-wrap items-center gap-2"><div className="relative min-w-[220px] flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" /><input value={localSearch} onChange={(e) => setLocalSearch(e.target.value)} placeholder="Search descriptions…" className={`${inputClass} pl-9`} /></div><select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} className={`${inputClass} w-auto min-w-[125px]`}><option value="">All types</option><option value="income">Income</option><option value="expense">Expense</option></select><select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className={`${inputClass} w-auto min-w-[145px]`}><option value="">All categories</option>{categories.map((item) => <option key={item}>{item}</option>)}</select><Field label="From"><input aria-label="Start date" type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className={`${inputClass} w-auto`} /></Field><Field label="To"><input aria-label="End date" type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className={`${inputClass} w-auto`} /></Field><select aria-label="Sort transactions" value={sort} onChange={(e) => setSort(e.target.value)} className={`${inputClass} w-auto min-w-[125px]`}><option value="date">Sort: date</option><option value="amount">Sort: amount</option><option value="category">Sort: category</option><option value="status">Sort: status</option></select><select aria-label="Sort direction" value={direction} onChange={(e) => setDirection(e.target.value)} className={`${inputClass} w-auto min-w-[100px]`}><option value="desc">Descending</option><option value="asc">Ascending</option></select><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold hover:bg-[var(--background)]"><Upload size={14} />Import CSV / Excel<input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) { setUploadedFile(file); setColumnMapping({}); setImportSummary(""); onUpload(file); } e.currentTarget.value = ""; }} /></label><div className="flex gap-1"><a href={`${API}/api/transactions/template.csv`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg px-2 py-2 text-[10px] font-semibold text-[#147354] hover:bg-[#f0f7f2]"><Download size={13} />CSV</a><a href={`${API}/api/transactions/template.xlsx`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg px-2 py-2 text-[10px] font-semibold text-[#147354] hover:bg-[#f0f7f2]"><Download size={13} />Excel</a></div></div>{importSummary && <p role="status" className="mt-3 rounded-lg bg-[#edf6ef] px-3 py-2 text-xs text-[#34724e]">{importSummary}</p>}
      {importPreview && <div className="mt-4 rounded-xl border border-[#dcece2] bg-[#f5faf6] p-4 dark:bg-[#203328]"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-sm font-semibold">Import preview</div><p className="mt-1 text-xs text-[var(--muted)]">{importPreview.valid_count} valid rows · {importPreview.invalid_count} invalid rows. Matching date, type, amount, and category records are skipped as duplicates.</p></div><div className="flex gap-2"><Button variant="secondary" onClick={() => { setImportPreview(null); setUploadedFile(null); }}>Cancel</Button><Button onClick={async () => { const result = await confirmImport(); if (result) { setImportSummary(`${result.imported} imported · ${result.duplicates} duplicates skipped · ${result.errors.length} row errors.`); setUploadedFile(null); } }} disabled={!importPreview.valid_count}><Check size={14} />Import valid rows</Button></div></div><div className="mt-3 grid gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 sm:grid-cols-2 xl:grid-cols-5">{importFields.map((field) => <Field key={field.key} label={`${field.label}${field.required ? " *" : ""}`}><select aria-label={`Map ${field.label}`} className={inputClass} value={effectiveMapping[field.key] ?? ""} onChange={(event) => setColumnMapping((previous) => ({ ...previous, [field.key]: event.target.value || null }))}><option value="">{field.required ? "Choose a column" : "Skip this field"}</option>{importPreview.columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></Field>)}<div className="flex items-end"><Button variant="secondary" disabled={!uploadedFile || !effectiveMapping.date || !effectiveMapping.amount} onClick={() => { if (uploadedFile) onRemap(uploadedFile, effectiveMapping); }}>Preview mapped columns</Button></div></div><div className="mt-3 max-h-48 overflow-auto rounded-lg border border-[var(--line)] bg-[var(--surface)]"><table className="w-full min-w-[520px] text-left text-[11px]"><thead className="sticky top-0 bg-[var(--background)] text-[var(--muted)]"><tr>{["Date", "Type", "Category", "Amount", "Description"].map((v) => <th key={v} className="px-3 py-2 font-medium">{v}</th>)}</tr></thead><tbody>{importPreview.rows.slice(0, 25).map((row, i) => <tr key={i} className="border-t border-[var(--line)]"><td className="px-3 py-2">{String(row.date)}</td><td className="px-3 py-2 capitalize">{String(row.kind)}</td><td className="px-3 py-2">{String(row.category)}</td><td className="px-3 py-2">{currency(Number(row.amount), code)}</td><td className="px-3 py-2">{String(row.description)}</td></tr>)}</tbody></table></div>{importPreview.errors.length > 0 && <div className="mt-2 text-[11px] text-[#ba554a]">First issue: row {importPreview.errors[0].line}: {importPreview.errors[0].error}</div>}</div>}
      <div className="mt-4 flex items-center justify-between text-[11px] text-[var(--muted)]"><span>{total.toLocaleString()} transactions</span><span>Showing up to 100 rows · use filters to narrow the list</span></div>
    </div>
    <div className="card soft-shadow overflow-hidden"><TransactionTable rows={rows} code={code} onEdit={onEdit} onDelete={onDelete} /><div className="flex items-center justify-between border-t border-[var(--line)] px-4 py-3 text-xs text-[var(--muted)]"><span>{total ? `Page ${page} of ${pages}` : "No matching records"} · {total.toLocaleString()} total</span><div className="flex gap-2"><Button variant="secondary" className="px-2.5 py-1.5 text-[10px]" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={13} />Previous</Button><Button variant="secondary" className="px-2.5 py-1.5 text-[10px]" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next<ChevronRight size={13} /></Button></div></div></div>
  </div>;
}

function TransactionTable({ rows, code, onEdit, onDelete, compact = false }: { rows: Transaction[]; code: string; onEdit?: (t: Transaction) => void; onDelete?: (id: number) => void; compact?: boolean }) {
  if (!rows.length) return <div className="p-8"><EmptyState title="No transactions found" subtitle="Add a transaction or import a CSV or Excel statement to get started." compact /></div>;
  return <div className="thin-scrollbar overflow-x-auto"><table className="w-full min-w-[720px] text-left text-xs"><thead className="bg-[var(--background)] text-[10px] font-semibold uppercase tracking-[.07em] text-[var(--muted)]"><tr>{["Transaction", "Category", "Date", "Status", "Amount", ...(compact ? [] : ["Actions"])].map((label) => <th key={label} className="px-5 py-3.5">{label}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t border-[var(--line)] transition hover:bg-[var(--background)]/70"><td className="px-5 py-3.5"><div className="font-semibold">{row.description || row.category}</div><div className="mt-1 text-[10px] text-[var(--muted)]">{row.payment_method}</div></td><td className="px-5 py-3.5 text-[var(--muted)]">{row.category}</td><td className="px-5 py-3.5 text-[var(--muted)]">{fmtDate(row.date)}</td><td className="px-5 py-3.5"><span className={`rounded-full px-2 py-1 text-[10px] font-semibold capitalize ${row.status === "completed" ? "bg-[#edf6ef] text-[#3e7957]" : row.status === "scheduled" ? "bg-[#eef2fb] text-[#5c70a3]" : "bg-[#fff5e4] text-[#98713a]"}`}>{row.status}</span></td><td className={`px-5 py-3.5 font-semibold ${row.kind === "income" ? "text-[#167653]" : "text-[var(--foreground)]"}`}>{row.kind === "income" ? "+" : "−"}{currency(row.amount, code)}</td>{!compact && <td className="px-5 py-3.5"><div className="flex gap-1"><button title="Edit transaction" onClick={() => onEdit?.(row)} className="rounded p-1.5 text-[var(--muted)] hover:bg-[var(--line)]"><Pencil size={13} /></button><button title="Delete transaction" onClick={() => onDelete?.(row.id)} className="rounded p-1.5 text-[var(--muted)] hover:bg-[#fff0ee] hover:text-[#b94337]"><Trash2 size={13} /></button></div></td>}</tr>)}</tbody></table></div>;
}

function TransactionModal({ open, onClose, editingId, rows, api, onSaved, onError }: { open: boolean; onClose: () => void; editingId: number | null; rows: Transaction[]; api: (path: string, init?: RequestInit) => Promise<unknown>; onSaved: () => void; onError: (e: string) => void }) {
  const form = useForm<z.input<typeof transactionSchema>, unknown, TransactionForm>({ resolver: zodResolver(transactionSchema), defaultValues: { kind: "income", category: "Sales Revenue", amount: 0, date: new Date().toISOString().slice(0, 10), description: "", payment_method: "Bank transfer", status: "completed" } });
  useEffect(() => {
    if (!open) return;
    const row = editingId ? rows.find((item) => item.id === editingId) : null;
    form.reset(row ? { kind: row.kind, category: row.category, amount: row.amount, date: row.date, description: row.description, payment_method: row.payment_method, status: row.status as TransactionForm["status"] } : { kind: "income", category: "Sales Revenue", amount: 0, date: new Date().toISOString().slice(0, 10), description: "", payment_method: "Bank transfer", status: "completed" });
  }, [editingId, form, open, rows]);
  const selectedKind = useWatch({ control: form.control, name: "kind" });
  if (!open) return null;
  const submit = async (data: TransactionForm) => {
    try { await api(editingId ? `/api/transactions/${editingId}` : "/api/transactions", { method: editingId ? "PUT" : "POST", body: JSON.stringify(data) }); onSaved(); }
    catch (e) { onError(messageFrom(e)); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div role="dialog" aria-modal="true" aria-labelledby="transaction-title" className="w-full max-w-[540px] rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-2xl sm:p-6">
    <div className="mb-5 flex items-start justify-between"><div><h2 id="transaction-title" className="text-lg font-semibold">{editingId ? "Edit transaction" : "Add transaction"}</h2><p className="mt-1 text-xs text-[var(--muted)]">Amounts are saved exactly to two decimal places.</p></div><button onClick={onClose} className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--background)]"><X size={17} /></button></div>
    <form onSubmit={form.handleSubmit(submit)} className="grid gap-4 sm:grid-cols-2">
      <Field label="Type"><select {...form.register("kind")} className={inputClass} onChange={(e) => { form.setValue("kind", e.target.value as "income" | "expense"); form.setValue("category", e.target.value === "income" ? "Sales Revenue" : "Salaries"); }}><option value="income">Income</option><option value="expense">Expense</option></select></Field>
      <Field label="Category"><select {...form.register("category")} className={inputClass}>{categories.filter((item) => selectedKind === "income" ? item.includes("Revenue") || item.includes("Income") : !item.includes("Revenue") && !item.includes("Income")).map((item) => <option key={item}>{item}</option>)}</select></Field>
      <Field label="Amount"><input type="number" step="0.01" min="0.01" placeholder="0.00" {...form.register("amount")} className={inputClass} />{form.formState.errors.amount && <span className="text-[10px] text-red-600">{form.formState.errors.amount.message}</span>}</Field>
      <Field label="Transaction date"><input type="date" {...form.register("date")} className={inputClass} /></Field>
      <Field label="Payment method"><select {...form.register("payment_method")} className={inputClass}>{["Bank transfer", "Card", "UPI", "Cash", "Cheque", "Imported", "Other"].map((item) => <option key={item}>{item}</option>)}</select></Field>
      <Field label="Status"><select {...form.register("status")} className={inputClass}><option value="completed">Completed</option><option value="pending">Pending</option><option value="scheduled">Scheduled</option></select></Field>
      <Field label="Description" className="sm:col-span-2"><input placeholder="Add a note or customer / supplier name" {...form.register("description")} className={inputClass} /></Field>
      <div className="mt-1 flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? "Saving…" : editingId ? "Save changes" : "Save transaction"}</Button></div>
    </form>
  </div></div>;
}

function RevenuePage({ series, forecast, horizon, setHorizon, code }: { series: { month: string; revenue: number }[]; forecast: Forecast | null; horizon: number; setHorizon: (n: number) => void; code: string }) {
  const values = forecast?.predictions.map((item) => ({ ...item, label: new Date(item.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }) })) ?? [];
  return <div className="grid gap-5"><PageIntro title="Revenue analytics" subtitle="Track income patterns and review a data validated revenue forecast." action={<HorizonSelect value={horizon} onChange={setHorizon} />} />
    <div className="grid gap-5 xl:grid-cols-2"><div className="card soft-shadow p-5 sm:p-6"><CardTitle title="Historical revenue" subtitle="Recorded revenue by month" /><div className="h-[310px]"><ResponsiveContainer width="100%" height="100%"><AreaChart data={series} margin={{ left: -12, right: 8, top: 5 }}><CartesianGrid vertical={false} strokeDasharray="3 4" /><XAxis dataKey="month" tickFormatter={monthLabel} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} /><YAxis tickFormatter={(v) => currency(Number(v), code, true)} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} width={64} /><Tooltip formatter={(v) => currency(Number(v), code)} contentStyle={tooltipStyle} /><Area dataKey="revenue" name="Revenue" type="monotone" stroke="#147653" strokeWidth={2.3} fill="#d8eee2" fillOpacity={.8} /></AreaChart></ResponsiveContainer></div></div>
    <div className="card soft-shadow p-5 sm:p-6"><CardTitle title={`${horizon}-day revenue forecast`} subtitle="Blue values are model estimates · shaded band shows validation error range" />{forecast ? <><div className="mb-3 flex flex-wrap items-center gap-2"><ModelPill model={forecast.selected_model} /><span className="text-[10px] text-[var(--muted)]">Trained through {fmtDate(forecast.training_end ?? undefined)}</span></div><div className="h-[270px]"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={values} margin={{ left: -12, right: 8, top: 8 }}><CartesianGrid vertical={false} strokeDasharray="3 4" /><XAxis dataKey="label" interval={Math.max(0, Math.floor(horizon / 12) - 1)} tickLine={false} axisLine={false} tick={{ fontSize: 9 }} /><YAxis tickFormatter={(v) => currency(Number(v), code, true)} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} width={64} /><Tooltip formatter={(v) => currency(Number(v), code)} contentStyle={tooltipStyle} /><Area dataKey="upper" name="Upper estimate" stroke="none" fill="#e4eefb" fillOpacity={.85} /><Area dataKey="lower" name="Lower estimate" stroke="none" fill="var(--surface)" fillOpacity={1} /><Line dataKey="value" name="Forecast" type="monotone" stroke="#4778d0" strokeWidth={2.2} dot={false} /></ComposedChart></ResponsiveContainer></div><p className="mt-2 text-[10px] leading-4 text-[var(--muted)]">Validation uses a time ordered holdout. The interval reflects past validation residuals and is not a guarantee of future accuracy.</p></> : <EmptyState title="Choose a forecast horizon" subtitle="A model forecast will load when this page opens." compact />}</div></div>
    <div className="card soft-shadow overflow-hidden"><div className="p-5"><CardTitle title="Model comparison" subtitle={`Walk-forward validation · training range ${fmtDate(forecast?.training_start ?? undefined)} — ${fmtDate(forecast?.training_end ?? undefined)}`} /></div><ModelTable metrics={forecast?.metrics ?? []} code={code} /></div>
  </div>;
}

function ExpensesPage({ overview, forecasts, horizon, setHorizon, code }: { overview: Overview | null; forecasts: { category: string; forecast_total: number; model: string }[]; horizon: number; setHorizon: (n: number) => void; code: string }) {
  const categoriesData = overview?.expense_categories ?? [];
  return <div className="grid gap-5"><PageIntro title="Expense analytics" subtitle="See which categories drive spend and where costs may be heading." action={<HorizonSelect value={horizon} onChange={setHorizon} />} />
    <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]"><div className="card soft-shadow p-5 sm:p-6"><CardTitle title="Expense by category" subtitle="Completed spending over the selected reporting period" /><div className="h-[340px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={categoriesData} layout="vertical" margin={{ left: 4, right: 20, top: 5, bottom: 5 }}><CartesianGrid horizontal={false} strokeDasharray="3 4" /><XAxis type="number" tickFormatter={(v) => currency(Number(v), code, true)} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} /><YAxis type="category" dataKey="category" width={130} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} /><Tooltip formatter={(v) => currency(Number(v), code)} contentStyle={tooltipStyle} /><Bar dataKey="amount" name="Spend" fill="#658abf" radius={[0, 5, 5, 0]} barSize={18} /></BarChart></ResponsiveContainer></div></div>
      <div className="card soft-shadow p-5 sm:p-6"><CardTitle title="Category concentration" subtitle="Share of total recorded expenses" /><div className="grid gap-4">{categoriesData.slice(0, 7).map((item, i) => <div key={item.category}><div className="mb-1.5 flex justify-between gap-2 text-xs"><span className="truncate">{item.category}</span><span className="font-semibold">{item.share_pct.toFixed(1)}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[var(--background)]"><div className="h-full rounded-full" style={{ width: `${Math.min(100, item.share_pct)}%`, background: ["#167653", "#588f72", "#8cb19a", "#6c8dc2", "#9eafd0", "#a8bdaf", "#d1ded6"][i] }} /></div></div>)}</div></div>
    </div>
    <div className="card soft-shadow overflow-hidden"><div className="p-5 sm:p-6"><CardTitle title={`${horizon}-day category forecast`} subtitle="Each category uses its own transaction history and model selection." /></div><div className="thin-scrollbar overflow-auto"><table className="w-full min-w-[560px] text-left text-xs"><thead className="bg-[var(--background)] text-[10px] uppercase tracking-wider text-[var(--muted)]"><tr>{["Category", "Forecast spend", "Model", "Period"].map((v) => <th key={v} className="px-5 py-3">{v}</th>)}</tr></thead><tbody>{forecasts.map((item) => <tr key={item.category} className="border-t border-[var(--line)]"><td className="px-5 py-3.5 font-semibold">{item.category}</td><td className="px-5 py-3.5">{currency(item.forecast_total, code)}</td><td className="px-5 py-3.5"><ModelPill model={item.model} /></td><td className="px-5 py-3.5 text-[var(--muted)]">Next {horizon} days</td></tr>)}</tbody></table>{forecasts.length === 0 && <div className="p-7"><EmptyState title="No expense history to forecast" subtitle="Add completed expense transactions to build category forecasts." compact /></div>}</div></div>
  </div>;
}

function CashflowPage({ cashflow, horizon, setHorizon, code }: { cashflow: Cashflow | null; horizon: number; setHorizon: (n: number) => void; code: string }) {
  return <div className="grid gap-5"><PageIntro title="Cash flow analysis" subtitle="Projected daily cash position combines model estimates with scheduled and pending items." action={<HorizonSelect value={horizon} onChange={setHorizon} />} />
    {!cashflow ? <LoadingCards /> : <>
      {cashflow.shortfall && <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#f1d4c5] bg-[#fff9f2] p-4 text-[#8d5b31]"><ShieldAlert size={20} /><div className="flex-1"><div className="text-sm font-semibold">Cash may cross your minimum reserve on {fmtDate(cashflow.shortfall.date)}</div><div className="mt-1 text-xs">Estimated reserve gap: {currency(cashflow.shortfall.amount_below_reserve, code)} · Consider accelerating collections or reviewing discretionary expenses.</div></div><span className="rounded-full bg-[#f7e9d9] px-2.5 py-1 text-[10px] font-bold uppercase">Attention</span></div>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><KpiCard label="Current cash" value={cashflow.opening_balance} note="Available opening balance" positive={cashflow.opening_balance >= 0} icon={Wallet} code={code} /><KpiCard label="Minimum reserve" value={cashflow.minimum_reserve} note="Your configured cash buffer" positive icon={ShieldAlert} code={code} /><KpiCard label="Minimum projected cash" value={cashflow.minimum_expected_balance} note="Lowest balance in this horizon" positive={cashflow.minimum_expected_balance >= cashflow.minimum_reserve} icon={Activity} code={code} /><KpiCard label="Shortage warning" value={cashflow.shortfall ? fmtDate(cashflow.shortfall.date) : "None expected"} note={cashflow.shortfall ? "Projected below reserve" : `Next ${horizon} days`} positive={!cashflow.shortfall} icon={CalendarDays} raw /></div>
      <div className="card soft-shadow p-5 sm:p-6"><CardTitle title={`Daily projected cash · ${horizon} days`} subtitle="Central estimate and model uncertainty range" /><div className="h-[360px]"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={cashflow.days} margin={{ left: -10, right: 10, top: 5 }}><CartesianGrid vertical={false} strokeDasharray="3 4" /><XAxis dataKey="date" interval={Math.max(0, Math.floor(horizon / 14) - 1)} tickFormatter={(v) => new Date(String(v) + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })} tickLine={false} axisLine={false} tick={{ fontSize: 9 }} /><YAxis tickFormatter={(v) => currency(Number(v), code, true)} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} width={70} /><Tooltip labelFormatter={(v) => fmtDate(String(v))} formatter={(v) => currency(Number(v), code)} contentStyle={tooltipStyle} /><Area dataKey="upper_balance" name="Upper estimate" stroke="none" fill="#e3edf9" fillOpacity={.75} /><Area dataKey="lower_balance" name="Lower estimate" stroke="none" fill="var(--surface)" /><Line dataKey="balance" name="Projected balance" type="monotone" stroke="#4778d0" strokeWidth={2.3} dot={false} /><Line dataKey={() => cashflow.minimum_reserve} name="Minimum reserve" stroke="#da766d" strokeDasharray="4 5" strokeWidth={1.5} dot={false} /></ComposedChart></ResponsiveContainer></div><div className="mt-3 grid gap-3 border-t border-[var(--line)] pt-4 text-[11px] text-[var(--muted)] sm:grid-cols-3"><p>Revenue model: <span className="font-medium text-[var(--foreground)]">{cashflow.revenue_model}</span></p><p>Expense model: <span className="font-medium text-[var(--foreground)]">{cashflow.expense_model}</span></p><p>{cashflow.confirmed_obligations} confirmed + {cashflow.recurring_occurrences} recurring due dates</p></div></div>
      <div className="card soft-shadow overflow-hidden"><div className="p-5"><CardTitle title="Projection detail" subtitle="Forecast inflows and outflows include pending or scheduled transaction dates." /></div><div className="thin-scrollbar overflow-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead className="bg-[var(--background)] text-[10px] uppercase tracking-wider text-[var(--muted)]"><tr>{["Date", "Forecast inflows", "Forecast outflows", "Projected balance", "Reserve range"].map((v) => <th key={v} className="px-5 py-3">{v}</th>)}</tr></thead><tbody>{cashflow.days.filter((_, i) => i % Math.max(1, Math.floor(horizon / 20)) === 0).map((item) => <tr key={item.date} className="border-t border-[var(--line)]"><td className="px-5 py-3">{fmtDate(item.date)}</td><td className="px-5 py-3 text-[#147653]">{currency(item.inflows, code)}</td><td className="px-5 py-3">{currency(item.outflows, code)}</td><td className="px-5 py-3 font-semibold">{currency(item.balance, code)}</td><td className="px-5 py-3 text-[var(--muted)]">{currency(item.lower_balance, code, true)} – {currency(item.upper_balance, code, true)}</td></tr>)}</tbody></table></div></div>
    </>}
  </div>;
}

function ForecastPage({ forecast, setForecast, horizon, setHorizon, code, api }: { forecast: Forecast | null; setForecast: (v: Forecast) => void; horizon: number; setHorizon: (n: number) => void; code: string; api: (path: string, init?: RequestInit) => Promise<unknown> }) {
  const [expenses, setExpenses] = useState<Forecast | null>(null);
  const [running, setRunning] = useState(false);
  const run = async () => {
    setRunning(true);
    try {
      let queued: { task_id: string };
      try { queued = await api("/api/forecasts/train/async", { method: "POST" }) as { task_id: string }; }
      catch (e) {
        if (!messageFrom(e).toLowerCase().includes("worker is unavailable")) throw e;
        const immediate = await api("/api/forecasts/train", { method: "POST" }) as { revenue: Forecast; expenses: Forecast };
        setForecast(immediate.revenue); setExpenses(immediate.expenses); return;
      }
      for (let attempt = 0; attempt < 120; attempt++) {
        const task = await api(`/api/forecasts/tasks/${queued.task_id}`) as { status: string; result?: { revenue: Forecast; expenses: Forecast }; error?: string };
        if (task.status === "completed" && task.result) { setForecast(task.result.revenue); setExpenses(task.result.expenses); return; }
        if (task.status === "failed") throw new Error(task.error ?? "Forecast training failed");
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
      throw new Error("Forecast training is still running. Reopen this page shortly to see the saved results.");
    } catch (e) { window.alert(messageFrom(e)); }
    finally { setRunning(false); }
  };
  return <div className="grid gap-5"><PageIntro title="AI forecasting" subtitle="Compare time-aware model validation and generate revenue and expense estimates." action={<div className="flex gap-2"><HorizonSelect value={horizon} onChange={setHorizon} /><Button onClick={run} disabled={running}><Sparkles size={14} />{running ? "Comparing models…" : "Train & compare"}</Button></div>} />
    <div className="grid gap-4 sm:grid-cols-3"><InfoCard label="Forecast scope" value={`Next ${horizon} days`} note="Daily estimate, selectable horizon" icon={CalendarDays} /><InfoCard label="Training data" value={forecast?.training_start ? `${fmtDate(forecast.training_start)} → ${fmtDate(forecast.training_end ?? undefined)}` : "Available after run"} note="Historical completed transactions" icon={Activity} /><InfoCard label="Evaluation" value="Time ordered holdout" note="MAE · RMSE · MAPE · WAPE" icon={Gauge} /></div>
    <div className="grid gap-5 xl:grid-cols-2"><div className="card soft-shadow overflow-hidden"><div className="p-5"><CardTitle title="Revenue model comparison" subtitle={`Selected: ${forecast?.selected_model ?? "Run a comparison"}`} /></div><ModelTable metrics={forecast?.metrics ?? []} code={code} /></div><div className="card soft-shadow overflow-hidden"><div className="p-5"><CardTitle title="Expense model comparison" subtitle={`Selected: ${expenses?.selected_model ?? "Run a comparison"}`} /></div><ModelTable metrics={expenses?.metrics ?? []} code={code} /></div></div>
    <div className="rounded-xl border border-[#dce7f5] bg-[#f5f8fd] p-4 text-[11px] leading-5 text-[#5b6e8a] dark:bg-[#202c3b]"><div className="mb-1 flex items-center gap-2 font-semibold text-[#4c6388]"><Lightbulb size={14} />Methodology & limitations</div>Candidate models are selected by lowest walk-forward WAPE on a time ordered holdout. MAPE excludes zero actual values; WAPE is undefined when the holdout has no activity. Prediction bands use validation residuals. With limited history the application reports a moving average baseline. Model selection does not guarantee future accuracy.</div>
  </div>;
}

function ModelTable({ metrics, code }: { metrics: Forecast["metrics"]; code: string }) {
  return <div className="thin-scrollbar overflow-auto"><table className="w-full min-w-[540px] text-left text-xs"><thead className="bg-[var(--background)] text-[10px] uppercase tracking-wider text-[var(--muted)]"><tr>{["Model", "MAE", "RMSE", "MAPE", "WAPE", "Status"].map((v) => <th key={v} className="px-4 py-3 font-semibold">{v}</th>)}</tr></thead><tbody>{metrics.map((m) => <tr key={m.model} className="border-t border-[var(--line)]"><td className="px-4 py-3 font-medium">{m.model}</td><td className="px-4 py-3">{currency(m.mae, code)}</td><td className="px-4 py-3">{currency(m.rmse, code)}</td><td className="px-4 py-3">{m.mape == null ? "—" : `${m.mape.toFixed(1)}%`}</td><td className="px-4 py-3">{m.wape == null ? "—" : `${m.wape.toFixed(1)}%`}</td><td className="px-4 py-3">{m.selected ? <span className="rounded-full bg-[#edf6ef] px-2 py-1 text-[10px] font-semibold text-[#28724d]">Selected</span> : <span className="text-[10px] text-[var(--muted)]">Validated</span>}</td></tr>)}</tbody></table>{!metrics.length && <div className="p-5 text-xs text-[var(--muted)]">Run model comparison to display holdout results.</div>}</div>;
}

function RiskPage({ risk }: { risk: RiskSnapshot | null }) {
  if (!risk) return <LoadingCards />;
  const { indicators } = risk;
  const score = risk.score;
  const category = risk.category === "healthy" ? "Healthy" : risk.category === "monitor" ? "Monitor" : "Elevated risk";
  const factors = [{ label: "Cash reserve coverage", value: `${indicators.cash_coverage_months.toFixed(1)} months`, ok: risk.deductions.cash_coverage === 0, detail: "Current cash ÷ recent monthly net burn" }, { label: "Net cash margin", value: `${indicators.cash_margin_pct.toFixed(1)}%`, ok: risk.deductions.profitability === 0, detail: "Net cash flow ÷ revenue over six months; this is not accrual accounting profit." }, { label: "Cash reserve outlook", value: indicators.reserve_breach ? `Below reserve ${fmtDate(indicators.reserve_breach.date)}` : "No projected breach", ok: !indicators.reserve_breach, detail: "Daily projection against configured minimum reserve" }, { label: "Revenue trend", value: `${indicators.monthly_revenue_growth_pct.toFixed(1)}% monthly change`, ok: risk.deductions.revenue_decline === 0, detail: "Latest month compared to previous month" }];
  return <div className="grid gap-5"><PageIntro title="Financial risk analysis" subtitle="A transparent view of reserve coverage, profitability, and the projected cash floor." />
    <div className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]"><div className="card soft-shadow flex flex-col items-center justify-center p-7"><div className="relative flex h-48 w-48 items-center justify-center rounded-full" style={{ background: `conic-gradient(${score >= 80 ? "#16805b" : score >= 55 ? "#d49a42" : "#d85c51"} ${score * 3.6}deg, var(--line) 0)` }}><div className="flex h-40 w-40 flex-col items-center justify-center rounded-full bg-[var(--surface)]"><div className="text-[44px] font-semibold tracking-[-.07em]">{score}</div><div className="text-[10px] uppercase tracking-widest text-[var(--muted)]">out of 100</div></div></div><div className="mt-4 text-sm font-semibold">{category}</div><p className="mt-2 max-w-xs text-center text-[11px] leading-5 text-[var(--muted)]">{risk.methodology}</p></div>
      <div className="card soft-shadow p-5 sm:p-6"><CardTitle title="Risk indicators" subtitle="Weights: cash coverage 30, profitability 30, reserve breach 25, revenue trend 15." /><div className="grid gap-3">{factors.map((item) => <div key={item.label} className="flex items-start gap-3 rounded-lg border border-[var(--line)] p-3.5"><span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${item.ok ? "bg-[#edf6ef] text-[#26724c]" : "bg-[#fff2e6] text-[#a66d2e]"}`}>{item.ok ? <Check size={13} /> : <ShieldAlert size={13} />}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap justify-between gap-1"><span className="text-xs font-semibold">{item.label}</span><span className={`text-xs font-semibold ${item.ok ? "text-[#3d7f5a]" : "text-[#b47738]"}`}>{item.value}</span></div><p className="mt-1 text-[10px] text-[var(--muted)]">{item.detail}</p></div></div>)}</div></div></div>
    <div className="card soft-shadow p-5"><CardTitle title="Suggested actions" subtitle="Based on the current risk indicators" /><div className="grid gap-2 text-xs text-[var(--muted)] sm:grid-cols-2"><div className="rounded-lg bg-[var(--background)] p-3">Keep committed payroll and rent visible as scheduled transactions.</div><div className="rounded-lg bg-[var(--background)] p-3">Review collections when receivables rise or revenue momentum weakens.</div><div className="rounded-lg bg-[var(--background)] p-3">Revisit discretionary spend if projected balance approaches the reserve.</div><div className="rounded-lg bg-[var(--background)] p-3">Recalculate after material updates to sales, costs, or payment dates.</div></div></div>
  </div>;
}

function SimulatorPage({ input, setInput, scenarios, result, setResult, code, api, onRefresh }: { input: ScenarioInput; setInput: (v: ScenarioInput) => void; scenarios: Scenario[]; result: Scenario | null; setResult: (v: Scenario | null) => void; code: string; api: (path: string, init?: RequestInit) => Promise<unknown>; onRefresh: () => Promise<void> }) {
  const [name, setName] = useState("Custom plan");
  const [working, setWorking] = useState(false);
  const simulate = async () => { setWorking(true); try { const response = await api("/api/scenarios/simulate", { method: "POST", body: JSON.stringify({ name, ...input }) }) as Scenario; setResult(response); } catch (e) { window.alert(messageFrom(e)); } finally { setWorking(false); } };
  const save = async () => { try { await api("/api/scenarios", { method: "POST", body: JSON.stringify({ name, ...input }) }); await onRefresh(); } catch (e) { window.alert(messageFrom(e)); } };
  return <div className="grid gap-5"><PageIntro title="What-if simulator" subtitle="Explore changes in revenue and operating costs with transparent cash impact." />
    <div className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]"><div className="card soft-shadow p-5 sm:p-6"><CardTitle title="Custom assumptions" subtitle="Change a driver and run the calculation." />
      <div className="grid gap-5"><label className="grid gap-2"><div className="flex justify-between text-xs"><span className="font-medium">Revenue change</span><span className="font-semibold text-[#147354]">{input.revenue_change_pct > 0 ? "+" : ""}{input.revenue_change_pct}%</span></div><input type="range" min="-30" max="30" step="5" value={input.revenue_change_pct} onChange={(e) => setInput({ ...input, revenue_change_pct: Number(e.target.value) })} className="accent-[#147354]" /><span className="flex justify-between text-[10px] text-[var(--muted)]"><span>−30%</span><span>Baseline</span><span>+30%</span></span></label>
      <label className="grid gap-2"><div className="flex justify-between text-xs"><span className="font-medium">Operating expense change</span><span className="font-semibold text-[#147354]">{input.expense_change_pct > 0 ? "+" : ""}{input.expense_change_pct}%</span></div><input type="range" min="-30" max="30" step="5" value={input.expense_change_pct} onChange={(e) => setInput({ ...input, expense_change_pct: Number(e.target.value) })} className="accent-[#147354]" /><span className="flex justify-between text-[10px] text-[var(--muted)]"><span>−30%</span><span>Baseline</span><span>+30%</span></span></label>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Other one-time cost"><input className={inputClass} type="number" min="0" step="1000" value={input.one_time_cost} onChange={(e) => setInput({ ...input, one_time_cost: Number(e.target.value) })} /></Field><Field label="New monthly revenue"><input className={inputClass} type="number" min="0" step="1000" value={input.new_monthly_revenue} onChange={(e) => setInput({ ...input, new_monthly_revenue: Number(e.target.value) })} /></Field></div>
      <details className="rounded-lg border border-[var(--line)] p-3"><summary className="cursor-pointer text-xs font-semibold">Category and business decision assumptions</summary><div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label={`Marketing reduction · ${input.marketing_reduction_pct}%`}><input className="accent-[#147354]" type="range" min="0" max="100" step="5" value={input.marketing_reduction_pct} onChange={(e) => setInput({ ...input, marketing_reduction_pct: Number(e.target.value) })} /></Field><Field label={`Salary increase · ${input.salary_increase_pct}%`}><input className="accent-[#147354]" type="range" min="0" max="100" step="5" value={input.salary_increase_pct} onChange={(e) => setInput({ ...input, salary_increase_pct: Number(e.target.value) })} /></Field><Field label={`Inventory increase · ${input.inventory_increase_pct}%`}><input className="accent-[#147354]" type="range" min="0" max="150" step="5" value={input.inventory_increase_pct} onChange={(e) => setInput({ ...input, inventory_increase_pct: Number(e.target.value) })} /></Field><Field label="New hires · monthly payroll"><input className={inputClass} type="number" min="0" step="1000" value={input.new_hire_monthly_cost} onChange={(e) => setInput({ ...input, new_hire_monthly_cost: Number(e.target.value) })} /></Field><Field label="Campaign · monthly cost"><input className={inputClass} type="number" min="0" step="1000" value={input.campaign_monthly_cost} onChange={(e) => setInput({ ...input, campaign_monthly_cost: Number(e.target.value) })} /></Field><Field label="Additional loan · monthly payment"><input className={inputClass} type="number" min="0" step="1000" value={input.additional_loan_payment} onChange={(e) => setInput({ ...input, additional_loan_payment: Number(e.target.value) })} /></Field><Field label="New loan · cash proceeds"><input className={inputClass} type="number" min="0" step="10000" value={input.loan_proceeds} onChange={(e) => setInput({ ...input, loan_proceeds: Number(e.target.value) })} /></Field><Field label="Capital investment · one-time"><input className={inputClass} type="number" min="0" step="10000" value={input.capital_investment} onChange={(e) => setInput({ ...input, capital_investment: Number(e.target.value) })} /></Field></div></details>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Projection period"><select className={inputClass} value={input.horizon_months} onChange={(e) => setInput({ ...input, horizon_months: Number(e.target.value) })}>{[3, 6, 9, 12, 18, 24].map((n) => <option key={n} value={n}>{n} months</option>)}</select></Field><Field label="Scenario name"><input className={inputClass} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></Field></div>
      <div className="flex gap-2"><Button onClick={simulate} disabled={working}><Activity size={14} />{working ? "Calculating…" : "Simulate scenario"}</Button><Button variant="secondary" onClick={save}>Save scenario</Button></div><p className="text-[10px] leading-4 text-[var(--muted)]">Calculations apply changes to the latest calendar month. Loans add cash proceeds and monthly payments to costs; capital and other one-time costs reduce closing cash.</p></div></div>
      <div className="grid content-start gap-5"><div className="card soft-shadow p-5 sm:p-6"><CardTitle title="Scenario comparison" subtitle="Same baseline transaction period, with explicit assumptions." /><div className="h-[270px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={scenarios} margin={{ left: -8, right: 10, top: 5 }}><CartesianGrid vertical={false} strokeDasharray="3 4" /><XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} /><YAxis tickFormatter={(v) => currency(Number(v), code, true)} tickLine={false} axisLine={false} tick={{ fontSize: 9 }} width={62} /><Tooltip formatter={(v) => currency(Number(v), code)} contentStyle={tooltipStyle} /><Legend wrapperStyle={{ fontSize: 10, paddingTop: 12 }} /><Bar dataKey="monthly_revenue" name="Monthly revenue" fill="#18805c" radius={[4, 4, 0, 0]} /><Bar dataKey="monthly_expenses" name="Monthly expenses" fill="#7896c4" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></div>
      {result && <div className="card soft-shadow p-5"><CardTitle title={`${result.name} result`} subtitle={`${result.horizon_months} month deterministic projection`} /><div className="grid grid-cols-2 gap-3">{[["Monthly revenue", result.monthly_revenue], ["Monthly expenses", result.monthly_expenses], ["Monthly net cash flow", result.monthly_net_cash_flow], ["Closing cash", result.closing_cash]].map(([label, value]) => <div key={String(label)} className="rounded-lg bg-[var(--background)] p-3"><div className="text-[10px] text-[var(--muted)]">{label}</div><div className="mt-1 text-sm font-semibold">{currency(Number(value), code)}</div></div>)}</div><div className="mt-3 flex items-center justify-between text-xs"><span>Cash risk</span><RiskBadge value={result.risk ?? "moderate"} /></div></div>}
      </div></div>
    <div className="card soft-shadow overflow-hidden"><div className="p-5"><CardTitle title="Saved scenarios" subtitle="Previously saved assumptions for this business." /></div>{scenarios.filter((item) => item.name !== "Baseline" && item.name !== "Optimistic" && item.name !== "Pessimistic").length ? <div className="divide-y divide-[var(--line)]">{scenarios.filter((item) => !["Baseline", "Optimistic", "Pessimistic"].includes(item.name)).map((item) => <div key={`${item.id}-${item.name}`} className="flex items-center gap-3 px-5 py-3"><div className="flex-1 text-xs font-semibold">{item.name}</div><div className="text-[10px] text-[var(--muted)]">Revenue {item.assumptions?.revenue_change_pct ?? 0}% · Expenses {item.assumptions?.expense_change_pct ?? 0}%</div><Button variant="secondary" className="px-2.5 py-1.5 text-[10px]" onClick={async () => { try { const value = await api(`/api/scenarios/${item.id}/simulate`, { method: "POST" }) as Scenario; setResult(value); } catch (e) { window.alert(messageFrom(e)); } }}>Run</Button></div>)}</div> : <div className="px-5 pb-5 text-xs text-[var(--muted)]">Save a custom scenario to compare it here later.</div>}</div>
  </div>;
}

function InsightsPage({ insights, onGenerate }: { insights: Insight[]; onGenerate: () => void }) {
  return <div className="grid gap-5"><PageIntro title="AI business insights" subtitle="Rule based observations with supporting figures and recommended actions." action={<Button variant="secondary" onClick={onGenerate}><Sparkles size={14} />Generate alerts</Button>} /><div className="grid gap-3">{insights.map((item, index) => <div key={`${item.title}-${index}`} className="card soft-shadow grid gap-4 p-5 sm:grid-cols-[auto_1fr_auto] sm:items-start"><span className={`flex h-9 w-9 items-center justify-center rounded-xl ${item.severity === "critical" ? "bg-[#fff0ee] text-[#bd4c42]" : item.severity === "warning" ? "bg-[#fff5e6] text-[#a87234]" : item.severity === "positive" ? "bg-[#eaf5ee] text-[#177451]" : "bg-[#eff3fa] text-[#6079a5]"}`}><Lightbulb size={17} /></span><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">{item.title}</h2><Severity value={item.severity} /></div><p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">{item.description}</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><div className="rounded-lg bg-[var(--background)] p-3"><div className="text-[9px] font-bold uppercase tracking-wider text-[var(--muted)]">Recommended action</div><div className="mt-1 text-xs leading-5">{item.recommended_action}</div></div><div className="rounded-lg bg-[var(--background)] p-3"><div className="text-[9px] font-bold uppercase tracking-wider text-[var(--muted)]">Evidence</div><div className="mt-1 text-[10px] leading-5 text-[var(--muted)]">{item.reference}</div></div></div><div className="mt-2 flex items-center gap-2 text-[10px] text-[var(--muted)]"><CalendarDays size={12} />{item.period}</div></div><button title="More details" className="hidden rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--background)] sm:block"><MoreHorizontal size={17} /></button></div>)}{!insights.length && <EmptyState title="No insights yet" subtitle="Record more activity or generate insights to review your business signals." />}</div></div>;
}

function RecurringPage({ items, setItems, code, api }: { items: Recurring[]; setItems: (v: Recurring[]) => void; code: string; api: (path: string, init?: RequestInit) => Promise<unknown> }) {
  const [form, setForm] = useState({ kind: "expense" as "income" | "expense", category: "Salaries", amount: "0", frequency: "monthly" as "weekly" | "monthly" | "quarterly", next_date: new Date().toISOString().slice(0, 10), end_date: "", description: "", payment_method: "Bank transfer" });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const refresh = async () => setItems(await api("/api/recurring") as Recurring[]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setMessage("");
    try { await api("/api/recurring", { method: "POST", body: JSON.stringify({ ...form, amount: Number(form.amount), end_date: form.end_date || null }) }); await refresh(); setMessage("Recurring item saved and included in cash projections."); }
    catch (e) { setMessage(messageFrom(e)); }
    finally { setSaving(false); }
  };
  const update = async (item: Recurring, enabled: boolean) => { try { await api(`/api/recurring/${item.id}`, { method: "PATCH", body: JSON.stringify({ enabled }) }); await refresh(); } catch (e) { setMessage(messageFrom(e)); } };
  const remove = async (item: Recurring) => { if (!window.confirm(`Delete recurring ${item.category.toLowerCase()}?`)) return; try { await api(`/api/recurring/${item.id}`, { method: "DELETE" }); await refresh(); } catch (e) { setMessage(messageFrom(e)); } };
  return <div className="grid gap-5"><PageIntro title="Recurring items" subtitle="Track predictable payments and receipts; future due dates feed cash projections." />
    <div className="grid gap-5 xl:grid-cols-[.82fr_1.18fr]"><form onSubmit={submit} className="card soft-shadow p-5 sm:p-6"><CardTitle title="Add a recurring item" subtitle="Rent, payroll, subscriptions, supplier costs, or expected receipts." /><div className="grid gap-3 sm:grid-cols-2"><Field label="Type"><select className={inputClass} value={form.kind} onChange={(e) => { const kind = e.target.value as "income" | "expense"; setForm({ ...form, kind, category: kind === "income" ? "Service Revenue" : "Salaries" }); }}><option value="expense">Expense</option><option value="income">Income</option></select></Field><Field label="Category"><select className={inputClass} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{categories.filter((item) => form.kind === "income" ? item.includes("Revenue") || item.includes("Income") : !item.includes("Revenue") && !item.includes("Income")).map((item) => <option key={item}>{item}</option>)}</select></Field><Field label="Amount"><input className={inputClass} type="number" min="0.01" step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field><Field label="Frequency"><select className={inputClass} value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value as typeof form.frequency })}><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option></select></Field><Field label="Next due date"><input className={inputClass} type="date" required value={form.next_date} onChange={(e) => setForm({ ...form, next_date: e.target.value })} /></Field><Field label="End date (optional)"><input className={inputClass} type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></Field><Field label="Description" className="sm:col-span-2"><input className={inputClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Monthly office rent" /></Field></div><div className="mt-4 flex items-center gap-3"><Button type="submit" disabled={saving}><Plus size={14} />{saving ? "Saving…" : "Add recurring item"}</Button>{message && <span className={`text-[10px] ${message.includes("saved") ? "text-[#36805a]" : "text-[#b94b42]"}`}>{message}</span>}</div></form>
      <div className="card soft-shadow overflow-hidden"><div className="p-5 sm:p-6"><CardTitle title="Active schedule" subtitle={`${items.filter((item) => item.enabled).length} active items · scheduled dates are not double counted`} /></div>{items.length ? <div className="thin-scrollbar overflow-x-auto"><table className="w-full min-w-[650px] text-left text-xs"><thead className="bg-[var(--background)] text-[10px] uppercase tracking-wider text-[var(--muted)]"><tr>{["Item", "Amount", "Frequency", "Next due", "Status", ""].map((v) => <th key={v} className="px-4 py-3">{v}</th>)}</tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-t border-[var(--line)]"><td className="px-4 py-3"><div className="font-semibold">{item.description || item.category}</div><div className="mt-1 text-[10px] text-[var(--muted)]">{item.category} · {item.kind}</div></td><td className="px-4 py-3 font-semibold">{currency(item.amount, code)}</td><td className="px-4 py-3 capitalize">{item.frequency}</td><td className="px-4 py-3">{fmtDate(item.next_date)}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[10px] ${item.enabled ? "bg-[#edf6ef] text-[#34724e]" : "bg-[var(--background)] text-[var(--muted)]"}`}>{item.enabled ? "Active" : "Paused"}</span></td><td className="px-4 py-3"><div className="flex gap-1"><Button variant="secondary" className="px-2 py-1.5 text-[10px]" onClick={() => update(item, !item.enabled)}>{item.enabled ? "Pause" : "Resume"}</Button><button aria-label="Delete recurring item" onClick={() => remove(item)} className="rounded p-1.5 text-[var(--muted)] hover:bg-[#fff0ee] hover:text-[#b94337]"><Trash2 size={13} /></button></div></td></tr>)}</tbody></table></div> : <div className="px-5 pb-6"><EmptyState title="No recurring activity" subtitle="Add monthly obligations or expected receipts to make cash projections more useful." compact /></div>}</div>
    </div><div className="rounded-xl border border-[#dce7f5] bg-[#f5f8fd] p-4 text-[11px] leading-5 text-[#5b6e8a] dark:bg-[#202c3b]"><span className="font-semibold">Forecast treatment:</span> recurring items are configurable assumptions applied on projected due dates. They remain distinct from completed historical actuals and scheduled or pending transactions with matching type, category, amount, and date.</div>
  </div>;
}

function AccountsInvoicesPage({ code, api, onRefresh }: { code: string; api: (path: string, init?: RequestInit) => Promise<unknown>; onRefresh: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [accountName, setAccountName] = useState("");
  const [accountType, setAccountType] = useState("bank");
  const [openingBalance, setOpeningBalance] = useState("0.00");
  const today = new Date().toISOString().slice(0, 10);
  const [invoiceForm, setInvoiceForm] = useState({ direction: "receivable" as Invoice["direction"], invoice_number: "", counterparty: "", issue_date: today, due_date: today, amount: "", category: "Sales Revenue", account_id: "", description: "" });
  const [paymentAmounts, setPaymentAmounts] = useState<Record<number, string>>({});
  const [working, setWorking] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([api("/api/accounts"), api("/api/invoices?limit=100")]).then(([accountResult, invoiceResult]) => {
      if (!active) return;
      setAccounts(accountResult as Account[]);
      setInvoices((invoiceResult as { items: Invoice[] }).items);
    }).catch((error: unknown) => { if (active) setMessage(messageFrom(error)); });
    return () => { active = false; };
  }, [api]);

  const refresh = async () => {
    try {
      const [accountResult, invoiceResult] = await Promise.all([api("/api/accounts"), api("/api/invoices?limit=100")]);
      setAccounts(accountResult as Account[]);
      setInvoices((invoiceResult as { items: Invoice[] }).items);
    } catch (error) { setMessage(messageFrom(error)); }
  };

  const addAccount = async (event: React.FormEvent) => {
    event.preventDefault(); setWorking("account"); setMessage("");
    try {
      await api("/api/accounts", { method: "POST", body: JSON.stringify({ name: accountName, account_type: accountType, opening_balance: Number(openingBalance), currency: code }) });
      setAccountName(""); setOpeningBalance("0.00"); setMessage("Account added."); await refresh();
    } catch (error) { setMessage(messageFrom(error)); }
    finally { setWorking(""); }
  };

  const addInvoice = async (event: React.FormEvent) => {
    event.preventDefault(); setWorking("invoice"); setMessage("");
    try {
      await api("/api/invoices", { method: "POST", body: JSON.stringify({ ...invoiceForm, amount: Number(invoiceForm.amount), account_id: invoiceForm.account_id ? Number(invoiceForm.account_id) : null }) });
      setInvoiceForm({ ...invoiceForm, invoice_number: "", counterparty: "", amount: "", description: "" });
      setMessage("Invoice saved and included in the cash projection."); await refresh(); onRefresh();
    } catch (error) { setMessage(messageFrom(error)); }
    finally { setWorking(""); }
  };

  const recordPayment = async (invoice: Invoice) => {
    const value = Number(paymentAmounts[invoice.id] || invoice.amount_due);
    if (!Number.isFinite(value) || value <= 0) { setMessage("Enter a payment amount greater than zero."); return; }
    setWorking(`payment-${invoice.id}`); setMessage("");
    try {
      await api(`/api/invoices/${invoice.id}/payments`, { method: "POST", body: JSON.stringify({ amount: value, paid_on: new Date().toISOString().slice(0, 10), payment_method: "Bank transfer" }) });
      setMessage("Payment recorded and added to the transaction ledger."); await refresh(); onRefresh();
    } catch (error) { setMessage(messageFrom(error)); }
    finally { setWorking(""); }
  };

  const activeCategories = categories.filter((item) => invoiceForm.direction === "receivable" ? item.includes("Revenue") || item.includes("Income") : !item.includes("Revenue") && !item.includes("Income"));
  return <div className="grid gap-5">
    <PageIntro title="Accounts & invoices" subtitle="Track account balances, customer receivables, supplier bills, and settled payments." action={<Button variant="secondary" onClick={() => void refresh()}><Activity size={14} />Refresh</Button>} />
    {message && <p role="status" className={`rounded-lg px-4 py-3 text-xs ${message.includes("saved") || message.includes("added") || message.includes("recorded") ? "bg-[#edf6ef] text-[#34724e]" : "bg-[#fff3f1] text-[#a44237]"}`}>{message}</p>}
    <div className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]">
      <form onSubmit={addAccount} className="card soft-shadow p-5 sm:p-6">
        <CardTitle title="Add a financial account" subtitle="Create bank, cash, card, or wallet accounts to organize posted transactions and invoice payments." />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1"><Field label="Account name"><input className={inputClass} value={accountName} onChange={(event) => setAccountName(event.target.value)} required minLength={2} maxLength={120} placeholder="Operating bank" /></Field><Field label="Type"><select className={inputClass} value={accountType} onChange={(event) => setAccountType(event.target.value)}><option value="bank">Bank</option><option value="cash">Cash</option><option value="card">Card</option><option value="wallet">Wallet</option></select></Field><Field label="Opening balance"><input className={inputClass} type="number" step="0.01" value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} required /></Field></div>
        <Button className="mt-4" type="submit" disabled={working === "account"}><Plus size={14} />{working === "account" ? "Saving…" : "Add account"}</Button>
      </form>
      <div className="card soft-shadow overflow-hidden"><div className="p-5 sm:p-6"><CardTitle title="Your accounts" subtitle="Account balance equals opening balance plus completed transactions linked to that account." /></div>{accounts.length ? <div className="divide-y divide-[var(--line)]">{accounts.map((account) => <div key={account.id} className="flex items-center gap-3 px-5 py-3.5"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#eff4fb] text-[#5578ac]"><Wallet size={16} /></span><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{account.name}</div><div className="mt-1 text-[10px] capitalize text-[var(--muted)]">{account.account_type} · {account.currency}{!account.is_active ? " · inactive" : ""}</div></div><div className="text-right text-xs font-semibold">{currency(account.current_balance, account.currency)}</div></div>)}</div> : <div className="px-5 pb-5 text-xs text-[var(--muted)]">No accounts yet. Add one to track balances by bank, cash, card, or wallet.</div>}</div>
    </div>
    <form onSubmit={addInvoice} className="card soft-shadow p-5 sm:p-6">
      <CardTitle title="Record an invoice or supplier bill" subtitle="Unpaid balances appear in receivables or payables and enter the cash projection on their due date." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Field label="Direction"><select className={inputClass} value={invoiceForm.direction} onChange={(event) => { const direction = event.target.value as Invoice["direction"]; setInvoiceForm({ ...invoiceForm, direction, category: direction === "receivable" ? "Sales Revenue" : "Rent" }); }}><option value="receivable">Customer receivable</option><option value="payable">Supplier payable</option></select></Field><Field label="Invoice number"><input className={inputClass} value={invoiceForm.invoice_number} onChange={(event) => setInvoiceForm({ ...invoiceForm, invoice_number: event.target.value })} required maxLength={80} /></Field><Field label="Customer or supplier"><input className={inputClass} value={invoiceForm.counterparty} onChange={(event) => setInvoiceForm({ ...invoiceForm, counterparty: event.target.value })} required minLength={2} maxLength={180} /></Field><Field label="Amount"><input className={inputClass} type="number" min="0.01" step="0.01" value={invoiceForm.amount} onChange={(event) => setInvoiceForm({ ...invoiceForm, amount: event.target.value })} required /></Field><Field label="Issue date"><input className={inputClass} type="date" value={invoiceForm.issue_date} onChange={(event) => setInvoiceForm({ ...invoiceForm, issue_date: event.target.value })} required /></Field><Field label="Due date"><input className={inputClass} type="date" value={invoiceForm.due_date} onChange={(event) => setInvoiceForm({ ...invoiceForm, due_date: event.target.value })} required /></Field><Field label="Category"><select className={inputClass} value={invoiceForm.category} onChange={(event) => setInvoiceForm({ ...invoiceForm, category: event.target.value })}>{activeCategories.map((item) => <option key={item}>{item}</option>)}</select></Field><Field label="Account"><select className={inputClass} value={invoiceForm.account_id} onChange={(event) => setInvoiceForm({ ...invoiceForm, account_id: event.target.value })}><option value="">Unassigned</option>{accounts.filter((account) => account.is_active).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></Field><Field label="Description" className="sm:col-span-2 xl:col-span-4"><input className={inputClass} value={invoiceForm.description} onChange={(event) => setInvoiceForm({ ...invoiceForm, description: event.target.value })} maxLength={240} /></Field></div>
      <Button className="mt-4" type="submit" disabled={working === "invoice"}><Plus size={14} />{working === "invoice" ? "Saving…" : "Save invoice"}</Button>
    </form>
    <div className="card soft-shadow overflow-hidden"><div className="p-5"><CardTitle title="Receivables and payables" subtitle="Record full or partial payments. Payments also create completed transactions for cash and account calculations." /></div>{invoices.length ? <div className="thin-scrollbar overflow-x-auto"><table className="w-full min-w-[920px] text-left text-xs"><thead className="bg-[var(--background)] text-[10px] uppercase tracking-wider text-[var(--muted)]"><tr>{["Invoice", "Direction", "Due date", "Total", "Outstanding", "Status", "Payment"].map((item) => <th key={item} className="px-4 py-3">{item}</th>)}</tr></thead><tbody>{invoices.map((invoice) => <tr key={invoice.id} className="border-t border-[var(--line)]"><td className="px-4 py-3"><div className="font-semibold">{invoice.invoice_number}</div><div className="mt-1 text-[10px] text-[var(--muted)]">{invoice.counterparty} · {invoice.category}</div></td><td className="px-4 py-3 capitalize">{invoice.direction}</td><td className="px-4 py-3">{fmtDate(invoice.due_date)}</td><td className="px-4 py-3">{currency(invoice.amount, invoice.currency)}</td><td className="px-4 py-3 font-semibold">{currency(invoice.amount_due, invoice.currency)}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${invoice.status === "paid" ? "bg-[#edf6ef] text-[#34724e]" : invoice.status === "overdue" ? "bg-[#fff0ee] text-[#b94b42]" : "bg-[#fff5e7] text-[#98703c]"}`}>{invoice.status.replace("_", " ")}</span></td><td className="px-4 py-3"><div className="flex items-center gap-2"><input aria-label={`Payment amount for ${invoice.invoice_number}`} disabled={invoice.amount_due <= 0} className={`${inputClass} w-28 py-1.5`} type="number" min="0.01" max={invoice.amount_due} step="0.01" placeholder={invoice.amount_due.toFixed(2)} value={paymentAmounts[invoice.id] ?? ""} onChange={(event) => setPaymentAmounts({ ...paymentAmounts, [invoice.id]: event.target.value })} /><Button variant="secondary" className="px-2.5 py-1.5 text-[10px]" disabled={invoice.amount_due <= 0 || working === `payment-${invoice.id}`} onClick={() => void recordPayment(invoice)}>{working === `payment-${invoice.id}` ? "Saving…" : "Record payment"}</Button></div></td></tr>)}</tbody></table></div> : <div className="px-5 pb-5 text-xs text-[var(--muted)]">No invoices yet. Add a customer receivable or a supplier bill to start managing working capital.</div>}</div>
  </div>;
}

function ReportsPage({ code, api }: { code: string; api: (path: string, init?: RequestInit) => Promise<unknown> }) {
  const [months, setMonths] = useState(12);
  const [reportType, setReportType] = useState("financial_summary");
  const [working, setWorking] = useState("");
  const [history, setHistory] = useState<ReportRecord[]>([]);
  const [message, setMessage] = useState("");
  const refreshHistory = useCallback(async () => {
    try { setHistory(await api("/api/reports") as ReportRecord[]); }
    catch (e) { setMessage(messageFrom(e)); }
  }, [api]);
  useEffect(() => {
    let active = true;
    api("/api/reports").then((result) => {
      if (active) setHistory(result as ReportRecord[]);
    }).catch((error: unknown) => {
      if (active) setMessage(messageFrom(error));
    });
    return () => { active = false; };
  }, [api]);
  const create = async (format: string) => {
    setWorking(format); setMessage("");
    try {
      const headers = new Headers({ "Content-Type": "application/json" });
      const token = localStorage.getItem("finsight-token"); if (token) headers.set("Authorization", `Bearer ${token}`);
      const business = localStorage.getItem("finsight-business"); if (business) headers.set("X-Business-Id", business);
      const response = await fetch(`${API}/api/reports/generate`, { method: "POST", headers, body: JSON.stringify({ format, months, report_type: reportType }) });
      if (!response.ok) { const body = await response.json(); throw new Error(body.detail ?? "Report generation failed"); }
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `finsight-${reportType}.${format}`; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); await refreshHistory();
    } catch (e) { setMessage(messageFrom(e)); } finally { setWorking(""); }
  };
  const types = [{ id: "financial_summary", label: "Financial summary" }, { id: "cash_flow", label: "Cash flow statement" }, { id: "revenue_analysis", label: "Revenue analysis" }, { id: "expense_analysis", label: "Expense analysis" }, { id: "forecast", label: "Forecast report" }, { id: "risk", label: "Cash shortage risk" }, { id: "scenario_comparison", label: "Scenario comparison" }];
  return <div className="grid gap-5"><PageIntro title="Reports" subtitle="Generate a data-backed report for the selected period, with actuals, forecasts, insights, and documented assumptions." /><div className="card soft-shadow p-5 sm:p-6"><CardTitle title="Create a financial report" subtitle="Choose report type, reporting period, and download format." /><div className="grid gap-4 sm:grid-cols-2"><Field label="Report type"><select className={inputClass} value={reportType} onChange={(e) => setReportType(e.target.value)}>{types.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field><Field label="Reporting period"><select className={inputClass} value={months} onChange={(e) => setMonths(Number(e.target.value))}><option value={1}>Current month</option><option value={3}>Quarter · 3 months</option><option value={6}>Last 6 months</option><option value={12}>Year · 12 months</option><option value={24}>Last 24 months</option><option value={36}>Last 36 months</option></select></Field><div className="flex flex-wrap gap-2 sm:col-span-2">{[{ id: "pdf", title: "PDF report", subtitle: "Summary, chart, forecast, insights" }, { id: "xlsx", title: "Excel workbook", subtitle: "Summary, trend chart, forecasts, data" }, { id: "csv", title: "CSV transactions", subtitle: "Dated actual and open transactions" }].map((item) => <button key={item.id} onClick={() => create(item.id)} disabled={!!working} className="min-w-[150px] flex-1 rounded-lg border border-[var(--line)] px-3 py-2.5 text-left transition hover:border-[#90b8a1] hover:bg-[#f5faf6] disabled:opacity-50"><div className="flex items-center gap-2 text-xs font-semibold"><Download size={14} className="text-[#147354]" />{working === item.id ? "Preparing…" : item.title}</div><div className="mt-1 text-[10px] text-[var(--muted)]">{item.subtitle}</div></button>)}</div>{message && <p role="alert" className="text-xs text-[#b94b42] sm:col-span-2">{message}</p>}</div></div><div className="card p-5"><div className="flex items-center justify-between"><div><div className="text-sm font-semibold">Recent exports</div><div className="mt-1 text-xs text-[var(--muted)]">Generated files download to your device; this history records export metadata.</div></div><Button variant="secondary" onClick={() => void refreshHistory()}><Activity size={14} />Refresh</Button></div>{history.length ? <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-[var(--line)] text-[10px] uppercase tracking-wide text-[var(--muted)]"><th className="py-2 pr-3">Report</th><th className="py-2 pr-3">Period</th><th className="py-2 pr-3">Format</th><th className="py-2">Generated</th></tr></thead><tbody>{history.map((item) => <tr key={item.id} className="border-b border-[var(--line)] last:border-0"><td className="py-2.5 pr-3 font-medium">{types.find((type) => type.id === item.report_type)?.label ?? item.report_type}</td><td className="py-2.5 pr-3">{item.period_months} mo</td><td className="py-2.5 pr-3 uppercase">{item.format}</td><td className="py-2.5">{item.generated_at ? new Date(item.generated_at).toLocaleString("en-IN") : "—"}</td></tr>)}</tbody></table></div> : <div className="mt-4 rounded-lg bg-[var(--background)] p-4 text-xs text-[var(--muted)]">No reports generated for this workspace yet.</div>}</div><div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5"><div className="flex items-start gap-3"><FileText size={17} className="mt-0.5 text-[#5577ae]" /><div><div className="text-sm font-semibold">Methodology included</div><p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--muted)]">Reports show completed historical activity separately from open obligations. PDF and Excel exports include server-calculated KPIs, monthly comparisons, forecasts, cash risk, model validation metrics, and rule-based insights with supporting calculations. Currency: {code}.</p></div></div></div></div>;
}

function NotificationsPage({ items, onRefresh, onRead }: { items: { id: number; title: string; message: string; severity: string; is_read: boolean; created_at: string }[]; onRefresh: () => void; onRead: (id: number) => void }) {
  return <div className="grid gap-5"><PageIntro title="Notifications" subtitle="Risk and cash reserve alerts generated from current financial indicators." action={<Button variant="secondary" onClick={onRefresh}><Activity size={14} />Refresh</Button>} />{items.length ? <div className="grid gap-3">{items.map((item) => <div key={item.id} className={`card flex items-start gap-3 p-4 ${item.is_read ? "opacity-70" : ""}`}><span className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg ${item.severity === "critical" ? "bg-[#fff0ee] text-[#ba4a40]" : "bg-[#fff5e8] text-[#9c713c]"}`}><Bell size={15} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold">{item.title}</span><Severity value={item.severity} /></div><p className="mt-1 text-xs leading-5 text-[var(--muted)]">{item.message}</p><div className="mt-1.5 text-[10px] text-[var(--muted)]">{item.created_at ? new Date(item.created_at).toLocaleString("en-IN") : ""}</div></div>{!item.is_read && <Button variant="secondary" className="px-2.5 py-1.5 text-[10px]" onClick={() => onRead(item.id)}><Check size={12} />Read</Button>}</div>)}</div> : <div className="card p-8"><EmptyState title="You’re all caught up" subtitle="Generate insights to create alerts for material financial risks." /></div>}</div>;
}

function SettingsPage({ form, setForm, code, api, onSaved }: { form: { name: string; currency: string; minimum_reserve: string; opening_cash: string }; setForm: (v: typeof form) => void; code: string; api: (path: string, init?: RequestInit) => Promise<unknown>; onSaved: () => void }) {
  const [message, setMessage] = useState(""); const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setSaving(true); setMessage(""); try { await api("/api/businesses/current", { method: "PATCH", body: JSON.stringify({ ...form, minimum_reserve: Number(form.minimum_reserve), opening_cash: Number(form.opening_cash) }) }); setMessage("Workspace settings saved."); await onSaved(); } catch (e) { setMessage(messageFrom(e)); } finally { setSaving(false); } };
  return <div className="grid gap-5"><PageIntro title="Settings" subtitle="Manage workspace reporting preferences and cash reserve alerts." /><form onSubmit={submit} className="card soft-shadow max-w-3xl p-5 sm:p-7"><CardTitle title="Business workspace" subtitle="These settings are applied to calculations and forecasts for the selected business." /><div className="grid gap-4 sm:grid-cols-2"><Field label="Business name"><input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} /></Field><Field label="Reporting currency"><select className={inputClass} value={form.currency || code} onChange={(e) => setForm({ ...form, currency: e.target.value })}>{["INR", "USD", "EUR", "GBP", "CAD", "AUD", "SGD", "AED"].map((v) => <option key={v}>{v}</option>)}</select></Field><Field label="Minimum cash reserve"><input className={inputClass} type="number" min="0" step="1000" value={form.minimum_reserve} onChange={(e) => setForm({ ...form, minimum_reserve: e.target.value })} /><span className="text-[10px] font-normal">Projected balance alerts use this threshold.</span></Field><Field label="Opening cash balance"><input className={inputClass} type="number" step="0.01" value={form.opening_cash} onChange={(e) => setForm({ ...form, opening_cash: e.target.value })} /><span className="text-[10px] font-normal">Set this to the balance at the start of your imported transaction history.</span></Field></div><div className="mt-5 flex items-center gap-3"><Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save settings"}</Button>{message && <span className={`text-xs ${message.includes("saved") ? "text-[#39805a]" : "text-[#b94b42]"}`}>{message}</span>}</div></form>
    <TeamAccessPanel api={api} />
    <div className="card max-w-3xl p-5"><CardTitle title="Data and forecasting" subtitle="How FinSight AI handles the information in this workspace." /><ul className="grid gap-2 text-xs leading-5 text-[var(--muted)]"><li>• Transaction amounts are stored as fixed precision decimals in the database.</li><li>• Forecasts are built from completed records; pending and scheduled transactions are applied on their due dates.</li><li>• Estimates use chronological validation and include limitations when history is sparse.</li><li>• A demo workspace contains synthetic example transactions. Keep demo data separate from real books.</li></ul></div>
  </div>;
}

function TeamAccessPanel({ api }: { api: (path: string, init?: RequestInit) => Promise<unknown> }) {
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "accountant" | "viewer">("viewer");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api("/api/businesses/current/members") as { members: WorkspaceMember[]; can_manage: boolean };
      setMembers(result.members); setCanManage(result.can_manage);
    } catch (error) { setNotice(messageFrom(error)); }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { const timer = window.setTimeout(() => { void refresh(); }, 0); return () => window.clearTimeout(timer); }, [refresh]);
  const mutateMember = async (member: WorkspaceMember, nextRole?: WorkspaceMember["role"]) => {
    setSaving(true); setNotice("");
    try {
      await api(`/api/businesses/current/members/${member.id}`, nextRole
        ? { method: "PATCH", body: JSON.stringify({ role: nextRole }) }
        : { method: "DELETE" });
      setNotice(nextRole ? "Member role updated." : "Member removed."); await refresh();
    } catch (error) { setNotice(messageFrom(error)); }
    finally { setSaving(false); }
  };
  const addMember = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setNotice("");
    try {
      await api("/api/businesses/current/members", { method: "POST", body: JSON.stringify({ email, role }) });
      setEmail(""); setNotice("Member added."); await refresh();
    } catch (error) { setNotice(messageFrom(error)); }
    finally { setSaving(false); }
  };
  return <section className="card max-w-3xl p-5 sm:p-7"><CardTitle title="Team access" subtitle="Add people who already have a FinSight account and choose what they can do." />
    {loading ? <p className="text-xs text-[var(--muted)]">Loading team…</p> : members.length > 0 && <div className="divide-y divide-[var(--line)]">{members.map((member) => <div key={member.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0"><div className="min-w-[180px] flex-1"><div className="text-xs font-semibold">{member.name}</div><div className="text-[10px] text-[var(--muted)]">{member.email}</div></div>{canManage && member.role !== "owner" ? <><select aria-label={`Role for ${member.email}`} value={member.role} disabled={saving} onChange={(event) => void mutateMember(member, event.target.value as WorkspaceMember["role"])} className={`${inputClass} w-auto min-w-[130px]`}><option value="admin">Admin</option><option value="accountant">Accountant</option><option value="viewer">Viewer</option></select><Button variant="secondary" disabled={saving} onClick={() => void mutateMember(member)}><Trash2 size={13} />Remove</Button></> : <span className="rounded-full bg-[var(--background)] px-2.5 py-1 text-[10px] font-semibold capitalize">{member.role}</span>}</div>)}</div>}
    {canManage && <form onSubmit={(event) => void addMember(event)} className="mt-4 grid gap-3 border-t border-[var(--line)] pt-4 sm:grid-cols-[1fr_auto_auto]"><Field label="Account email"><input className={inputClass} type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="teammate@example.com" /></Field><Field label="Role"><select className={inputClass} value={role} onChange={(event) => setRole(event.target.value as typeof role)}><option value="viewer">Viewer</option><option value="accountant">Accountant</option><option value="admin">Admin</option></select></Field><div className="self-end"><Button type="submit" disabled={saving || !email.trim()}><Plus size={14} />Add member</Button></div></form>}
    {notice && <p role="status" className={`mt-3 text-xs ${notice.includes("failed") || notice.includes("Only workspace") || notice.includes("cannot") || notice.includes("already") || notice.includes("Ask this") ? "text-[#b94b42]" : "text-[var(--muted)]"}`}>{notice}</p>}
  </section>;
}

function HorizonSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) { return <select aria-label="Forecast horizon" value={value} onChange={(e) => onChange(Number(e.target.value))} className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs font-medium outline-none focus:border-[#66a787]">{[7, 30, 90, 180, 365].map((n) => <option key={n} value={n}>{n} days</option>)}</select>; }
function PageIntro({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) { return <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-[22px] font-semibold tracking-[-.04em]">{title}</h1><p className="mt-1 text-xs text-[var(--muted)]">{subtitle}</p></div>{action}</div>; }
function InfoCard({ label, value, note, icon: Icon }: { label: string; value: string; note: string; icon: LucideIcon }) { return <div className="card soft-shadow p-4"><div className="flex items-center justify-between"><span className="text-[10px] font-medium text-[var(--muted)]">{label}</span><Icon size={15} className="text-[#53816a]" /></div><div className="mt-2 text-sm font-semibold">{value}</div><div className="mt-1 text-[10px] text-[var(--muted)]">{note}</div></div>; }
function ModelPill({ model }: { model: string }) { return <span className="inline-flex items-center gap-1.5 rounded-full bg-[#edf3fc] px-2.5 py-1 text-[10px] font-semibold text-[#4d6a9b]"><Sparkles size={11} />{model}</span>; }
function RiskBadge({ value }: { value: string }) { return <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${value === "low" ? "bg-[#edf6ef] text-[#34724e]" : value === "high" ? "bg-[#fff0ee] text-[#b94b42]" : "bg-[#fff5e7] text-[#98703c]"}`}>{value}</span>; }
function Severity({ value }: { value: string }) { return <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${value === "critical" ? "bg-[#fff0ee] text-[#b6493f]" : value === "warning" ? "bg-[#fff5e7] text-[#9b7139]" : value === "positive" ? "bg-[#edf6ef] text-[#34724e]" : "bg-[#eff3fa] text-[#6079a5]"}`}>{value}</span>; }
function InsightRow({ item }: { item: Insight }) { return <div className="flex gap-3 rounded-lg bg-[var(--background)] p-3.5"><span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${item.severity === "critical" ? "bg-[#fff0ee] text-[#bd4c42]" : item.severity === "warning" ? "bg-[#fff4e4] text-[#a87234]" : item.severity === "positive" ? "bg-[#eaf5ee] text-[#177451]" : "bg-[#eff3fa] text-[#6079a5]"}`}><Lightbulb size={14} /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold">{item.title}</span><Severity value={item.severity} /></div><p className="mt-1 text-[11px] leading-4 text-[var(--muted)]">{item.description}</p><p className="mt-1.5 text-[10px] leading-4 text-[#527960]">{item.recommended_action}</p></div></div>; }
function EmptyState({ title, subtitle, compact = false }: { title: string; subtitle: string; compact?: boolean }) { return <div className={`flex flex-col items-center justify-center text-center ${compact ? "py-3" : "min-h-[180px] py-6"}`}><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#edf5ef] text-[#518067]"><FileText size={16} /></div><div className="mt-2 text-xs font-semibold">{title}</div><p className="mt-1 max-w-sm text-[10px] leading-4 text-[var(--muted)]">{subtitle}</p></div>; }
function LoadingCards() { return <div className="grid gap-4"><div className="h-16 animate-pulse rounded-xl bg-[var(--line)]/60" /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-[var(--line)]/60" />)}</div><div className="h-72 animate-pulse rounded-xl bg-[var(--line)]/60" /></div>; }
const tooltipStyle: React.CSSProperties = { borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", boxShadow: "0 5px 16px rgba(0,0,0,.08)", fontSize: 11 };
