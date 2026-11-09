"use client";

import React, { useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell,
  ComposedChart, Legend, Line, Pie, PieChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis
} from "recharts";

interface DashboardChartsProps {
  code: string;
  monthlyData: { month: string; revenue: number; expenses: number; net_cash_flow: number }[];
  expenseCategories: { category: string; amount: number; share_pct: number }[];
  revenueCategories: { category: string; amount: number; share_pct: number }[];
  cashflowData: { date: string; balance: number; inflows: number; outflows: number; lower_balance?: number; upper_balance?: number }[];
  minimumReserve: number;
  receivables: number;
  payables: number;
  runwayDays: number | null;
  averageMonthlyBurn: number;
}

const tooltipStyle: React.CSSProperties = {
  borderRadius: 10,
  border: "1px solid var(--line)",
  backgroundColor: "var(--surface)",
  boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
  fontSize: 11,
  color: "var(--foreground)"
};

const CHART_COLORS = [
  "#167654", "#2e9e6b", "#48bf86", "#58a6ff",
  "#79c0ff", "#a371f7", "#bc8cff", "#d29922",
  "#e3b341", "#f0883e", "#f85149"
];

export function DashboardCharts({
  code,
  monthlyData,
  expenseCategories,
  revenueCategories,
  cashflowData,
  minimumReserve,
  receivables,
  payables,
  runwayDays,
  averageMonthlyBurn,
}: DashboardChartsProps) {
  const [activeTab, setActiveTab] = useState<
    "overview" | "cash_trend" | "categories" | "receivables_payables" | "runway_burn"
  >("overview");

  const fmtCurrency = (val: number, compact = false) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: code,
      maximumFractionDigits: compact ? 0 : 2,
      notation: compact && Math.abs(val) >= 100000 ? "compact" : "standard"
    }).format(Number.isFinite(val) ? val : 0);
  };

  const fmtMonth = (mStr: string) => {
    if (!mStr) return "";
    try {
      const parts = mStr.split("-");
      if (parts.length >= 2) {
        const d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
        return d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
      }
    } catch {
      // fallback
    }
    return mStr;
  };

  const fmtDay = (dStr: string) => {
    if (!dStr) return "";
    try {
      const parts = dStr.split("-");
      if (parts.length >= 3) {
        const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
      }
    } catch {
      // fallback
    }
    return dStr;
  };

  return (
    <div className="space-y-6">
      {/* Chart Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-3">
        <div className="flex flex-wrap gap-2 text-xs">
          <button
            onClick={() => setActiveTab("overview")}
            className={`rounded-lg px-3 py-1.5 font-medium transition ${
              activeTab === "overview"
                ? "bg-[#147354] text-white"
                : "border border-[var(--line)] text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
            }`}
          >
            1 & 2. Revenue vs Expenses & Cash Flow
          </button>
          <button
            onClick={() => setActiveTab("cash_trend")}
            className={`rounded-lg px-3 py-1.5 font-medium transition ${
              activeTab === "cash_trend"
                ? "bg-[#147354] text-white"
                : "border border-[var(--line)] text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
            }`}
          >
            3 & 10. Daily Cash Balance & Forecast
          </button>
          <button
            onClick={() => setActiveTab("categories")}
            className={`rounded-lg px-3 py-1.5 font-medium transition ${
              activeTab === "categories"
                ? "bg-[#147354] text-white"
                : "border border-[var(--line)] text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
            }`}
          >
            6 & 7. Category Mix (Expense & Revenue)
          </button>
          <button
            onClick={() => setActiveTab("receivables_payables")}
            className={`rounded-lg px-3 py-1.5 font-medium transition ${
              activeTab === "receivables_payables"
                ? "bg-[#147354] text-white"
                : "border border-[var(--line)] text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
            }`}
          >
            9. Receivables vs Payables
          </button>
          <button
            onClick={() => setActiveTab("runway_burn")}
            className={`rounded-lg px-3 py-1.5 font-medium transition ${
              activeTab === "runway_burn"
                ? "bg-[#147354] text-white"
                : "border border-[var(--line)] text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
            }`}
          >
            4, 5 & 8. Monthly Breakdown & Runway
          </button>
        </div>
      </div>

      {/* Tab 1: Revenue vs Expenses & Net Cash Flow Trend */}
      {activeTab === "overview" && (
        <div className="grid gap-6 xl:grid-cols-2">
          {/* Chart 1: Revenue vs Expenses */}
          <div className="card soft-shadow p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[var(--foreground)]">1. Revenue vs Expenses</h3>
                <p className="text-xs text-[var(--muted)]">Monthly completed income vs completed spending</p>
              </div>
            </div>
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monthlyData} margin={{ left: -10, right: 10, top: 10, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 4" stroke="var(--line)" />
                  <XAxis dataKey="month" tickFormatter={fmtMonth} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                  <YAxis tickFormatter={(v) => fmtCurrency(Number(v), true)} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} width={64} />
                  <Tooltip formatter={(v) => fmtCurrency(Number(v))} labelFormatter={(l) => fmtMonth(String(l))} contentStyle={tooltipStyle} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 10 }} />
                  <Area dataKey="revenue" name="Revenue" fill="#2ea043" stroke="#238636" strokeWidth={2} fillOpacity={0.15} />
                  <Line dataKey="expenses" name="Expenses" stroke="#58a6ff" strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 2: Net Cash Flow Trend */}
          <div className="card soft-shadow p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[var(--foreground)]">2. Net Cash Flow Trend</h3>
                <p className="text-xs text-[var(--muted)]">Net monthly operating cash flow (Inflow − Outflow)</p>
              </div>
            </div>
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData} margin={{ left: -10, right: 10, top: 10, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 4" stroke="var(--line)" />
                  <XAxis dataKey="month" tickFormatter={fmtMonth} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                  <YAxis tickFormatter={(v) => fmtCurrency(Number(v), true)} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} width={64} />
                  <Tooltip formatter={(v) => fmtCurrency(Number(v))} labelFormatter={(l) => fmtMonth(String(l))} contentStyle={tooltipStyle} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 10 }} />
                  <ReferenceLine y={0} stroke="var(--line)" />
                  <Bar dataKey="net_cash_flow" name="Net Cash Flow" radius={[4, 4, 0, 0]}>
                    {monthlyData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.net_cash_flow >= 0 ? "#238636" : "#f85149"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Daily Cash Balance & Historical vs Forecasted Cash Flow */}
      {activeTab === "cash_trend" && (
        <div className="grid gap-6 xl:grid-cols-2">
          {/* Chart 3: Daily Cash Balance */}
          <div className="card soft-shadow p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[var(--foreground)]">3. Projected Daily Cash Balance</h3>
                <p className="text-xs text-[var(--muted)]">Operating liquidity vs minimum reserve threshold</p>
              </div>
              <div className="text-right text-xs">
                <span className="text-[var(--muted)]">Reserve Target: </span>
                <span className="font-semibold text-[var(--foreground)]">{fmtCurrency(minimumReserve, true)}</span>
              </div>
            </div>
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={cashflowData.slice(0, 45)} margin={{ left: -10, right: 10, top: 10, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 4" stroke="var(--line)" />
                  <XAxis dataKey="date" tickFormatter={fmtDay} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                  <YAxis tickFormatter={(v) => fmtCurrency(Number(v), true)} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} width={64} />
                  <Tooltip formatter={(v) => fmtCurrency(Number(v))} labelFormatter={(l) => fmtDay(String(l))} contentStyle={tooltipStyle} />
                  <ReferenceLine y={minimumReserve} stroke="#f85149" strokeDasharray="3 3" label={{ value: "Reserve", position: "insideTopLeft", fill: "#f85149", fontSize: 10 }} />
                  <Area dataKey="balance" name="Cash Balance" stroke="#167654" strokeWidth={2} fill="#238636" fillOpacity={0.15} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 10: Historical vs Forecasted Cash Flow with Confidence Bands */}
          <div className="card soft-shadow p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[var(--foreground)]">10. Forecasted Cash Flow Bands</h3>
                <p className="text-xs text-[var(--muted)]">Projected cash position with empirical error bounds</p>
              </div>
            </div>
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={cashflowData} margin={{ left: -10, right: 10, top: 10, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 4" stroke="var(--line)" />
                  <XAxis dataKey="date" tickFormatter={fmtDay} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                  <YAxis tickFormatter={(v) => fmtCurrency(Number(v), true)} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} width={64} />
                  <Tooltip formatter={(v) => fmtCurrency(Number(v))} labelFormatter={(l) => fmtDay(String(l))} contentStyle={tooltipStyle} />
                  <Area dataKey="upper_balance" stroke="none" fill="#58a6ff" fillOpacity={0.12} name="Upper Bound" />
                  <Area dataKey="lower_balance" stroke="none" fill="var(--surface)" fillOpacity={1} name="Lower Bound" />
                  <Line dataKey="balance" stroke="#2ea043" strokeWidth={2} dot={false} name="Expected Position" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Category Breakdowns (Expense & Revenue) */}
      {activeTab === "categories" && (
        <div className="grid gap-6 xl:grid-cols-2">
          {/* Chart 6: Expense Category Breakdown */}
          <div className="card soft-shadow p-5 sm:p-6">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-[var(--foreground)]">6. Expense Category Breakdown</h3>
              <p className="text-xs text-[var(--muted)]">Relative share of total business spending</p>
            </div>
            <div className="flex flex-col sm:flex-row items-center gap-6">
              <div className="h-[200px] w-[200px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={expenseCategories.slice(0, 7)}
                      dataKey="amount"
                      nameKey="category"
                      innerRadius={55}
                      outerRadius={80}
                      paddingAngle={3}
                      stroke="none"
                    >
                      {expenseCategories.slice(0, 7).map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => fmtCurrency(Number(v))} contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-2 text-xs w-full">
                {expenseCategories.slice(0, 5).map((item, i) => (
                  <div key={item.category} className="flex items-center justify-between border-b border-[var(--line)] pb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                      <span className="text-[var(--foreground)]">{item.category}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[var(--muted)]">{fmtCurrency(item.amount, true)}</span>
                      <span className="font-semibold text-[var(--foreground)]">{item.share_pct.toFixed(1)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Chart 7: Revenue Category Breakdown */}
          <div className="card soft-shadow p-5 sm:p-6">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-[var(--foreground)]">7. Revenue Category Breakdown</h3>
              <p className="text-xs text-[var(--muted)]">Breakdown of income sources</p>
            </div>
            <div className="flex flex-col sm:flex-row items-center gap-6">
              <div className="h-[200px] w-[200px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={revenueCategories}
                      dataKey="amount"
                      nameKey="category"
                      innerRadius={55}
                      outerRadius={80}
                      paddingAngle={3}
                      stroke="none"
                    >
                      {revenueCategories.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => fmtCurrency(Number(v))} contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-2 text-xs w-full">
                {revenueCategories.slice(0, 5).map((item, i) => (
                  <div key={item.category} className="flex items-center justify-between border-b border-[var(--line)] pb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                      <span className="text-[var(--foreground)]">{item.category}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[var(--muted)]">{fmtCurrency(item.amount, true)}</span>
                      <span className="font-semibold text-[var(--foreground)]">{item.share_pct.toFixed(1)}%</span>
                    </div>
                  </div>
                ))}
                {revenueCategories.length === 0 && <p className="text-[var(--muted)]">No completed revenue categories in this period.</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Receivables vs Payables */}
      {activeTab === "receivables_payables" && (
        <div className="card soft-shadow p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-[var(--foreground)]">9. Receivables vs Payables (Working Capital Obligations)</h3>
              <p className="text-xs text-[var(--muted)]">Pending customer cash inflows vs upcoming supplier cash outflows</p>
            </div>
            <div className="flex gap-4 text-xs">
              <div>
                <span className="text-[var(--muted)]">Receivables: </span>
                <span className="font-semibold text-[#2ea043]">{fmtCurrency(receivables)}</span>
              </div>
              <div>
                <span className="text-[var(--muted)]">Payables: </span>
                <span className="font-semibold text-[#f85149]">{fmtCurrency(payables)}</span>
              </div>
            </div>
          </div>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={[
                  { name: "Receivables (Inflow)", amount: receivables, fill: "#2ea043" },
                  { name: "Payables (Outflow)", amount: payables, fill: "#f85149" },
                  { name: "Net Difference", amount: receivables - payables, fill: receivables >= payables ? "#58a6ff" : "#d29922" }
                ]}
                margin={{ left: -10, right: 10, top: 20, bottom: 0 }}
              >
                <CartesianGrid vertical={false} strokeDasharray="3 4" stroke="var(--line)" />
                <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => fmtCurrency(Number(v), true)} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} width={64} />
                <Tooltip formatter={(v) => fmtCurrency(Number(v))} contentStyle={tooltipStyle} />
                <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                  <Cell fill="#2ea043" />
                  <Cell fill="#f85149" />
                  <Cell fill={receivables >= payables ? "#58a6ff" : "#d29922"} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Tab 5: Monthly Revenue, Expense & Runway Projection */}
      {activeTab === "runway_burn" && (
        <div className="grid gap-6 xl:grid-cols-2">
          {/* Chart 4 & 5: Monthly Revenue & Expense Growth */}
          <div className="card soft-shadow p-5 sm:p-6">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-[var(--foreground)]">4 & 5. Monthly Revenue & Expense Levels</h3>
              <p className="text-xs text-[var(--muted)]">Historical side-by-side comparison per reporting month</p>
            </div>
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData} margin={{ left: -10, right: 10, top: 10, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 4" stroke="var(--line)" />
                  <XAxis dataKey="month" tickFormatter={fmtMonth} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                  <YAxis tickFormatter={(v) => fmtCurrency(Number(v), true)} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} width={64} />
                  <Tooltip formatter={(v) => fmtCurrency(Number(v))} labelFormatter={(l) => fmtMonth(String(l))} contentStyle={tooltipStyle} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 10 }} />
                  <Bar dataKey="revenue" name="Monthly Revenue" fill="#2ea043" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expenses" name="Monthly Expenses" fill="#58a6ff" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 8: Cash Runway Projection */}
          <div className="card soft-shadow p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[var(--foreground)]">8. Cash Runway Projection</h3>
                <p className="text-xs text-[var(--muted)]">Projected runway depletion based on trailing net burn</p>
              </div>
              <div className="text-xs">
                <span className="text-[var(--muted)]">Runway: </span>
                <span className="font-semibold text-[var(--foreground)]">
                  {runwayDays !== null ? `${Math.round(runwayDays)} Days` : "Healthy / Zero Burn"}
                </span>
              </div>
            </div>
            <div className="flex flex-col justify-center h-[280px] space-y-6">
              <div className="rounded-xl border border-[var(--line)] bg-[var(--background)] p-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[var(--muted)]">Average Monthly Burn</span>
                  <span className="font-bold text-[var(--foreground)]">{fmtCurrency(averageMonthlyBurn)}</span>
                </div>
                <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-[var(--line)]">
                  <div
                    className="h-full rounded-full bg-[#f85149]"
                    style={{ width: `${Math.min(100, Math.max(10, (averageMonthlyBurn / (averageMonthlyBurn + 500000)) * 100))}%` }}
                  />
                </div>
              </div>

              <div className="rounded-xl border border-[var(--line)] bg-[var(--background)] p-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[var(--muted)]">Runway Health Status</span>
                  <span className="font-bold text-[var(--foreground)]">
                    {runwayDays === null ? "No trailing net burn" : `${runwayDays} Days Available`}
                  </span>
                </div>
                <p className="mt-2 text-[11px] leading-5 text-[var(--muted)]">
                  {runwayDays === null
                    ? "Recorded inflows cover spending over the trailing period. Future obligations and reserve targets should be reviewed separately."
                    : "This estimate uses recorded trailing net burn. Accelerate collections or review expenses to extend runway; future cash flows may differ."}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
