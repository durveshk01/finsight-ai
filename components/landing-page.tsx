"use client";

import { useState } from "react";
import {
  Activity, ArrowRight, ArrowUpRight, CheckCircle2, ChevronDown,
  CircleDollarSign, Clock3, Cpu, Database, Gauge, Layers,
  Lock, Play, ShieldCheck, Sparkles, TrendingUp
} from "lucide-react";
import {
  Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer,
  Tooltip, XAxis, YAxis
} from "recharts";

interface LandingPageProps {
  onLaunchApp: () => void;
  onExploreDemo: () => void;
  onOpenLogin: () => void;
}

const sampleForecastData = [
  { day: "Day 1", actual: 12400, forecast: 12400, lower: 11900, upper: 12900 },
  { day: "Day 5", actual: 13100, forecast: 13100, lower: 12400, upper: 13800 },
  { day: "Day 10", actual: 14500, forecast: 14500, lower: 13600, upper: 15400 },
  { day: "Day 15", actual: 15200, forecast: 15200, lower: 14100, upper: 16300 },
  { day: "Day 20", actual: null, forecast: 16400, lower: 14900, upper: 17900 },
  { day: "Day 25", actual: null, forecast: 17800, lower: 15800, upper: 19800 },
  { day: "Day 30", actual: null, forecast: 19200, lower: 16900, upper: 21500 },
];

const faqs = [
  {
    q: "How does FinSight AI protect our company's financial data?",
    a: "We enforce strict business-level tenant isolation, Argon2 password hashing, short-lived signed JWT session tokens, and end-to-end HTTPS encryption. Your financial numbers are never used to train external public models."
  },
  {
    q: "What makes FinSight's forecasting different from traditional tools?",
    a: "Unlike tools that assume simple linear growth, FinSight AI benchmarks walk-forward cross-validation across ARIMA, SARIMA, Holt-Winters, Gradient Boosting, and XGBoost models. It selects the lowest-error model and displays empirical confidence intervals rather than invented certainties."
  },
  {
    q: "How does device-powered local computing work?",
    a: "FinSight performs calculations such as transaction aggregations, KPI analytics, category mixes, scenario simulations, and duplicate detection directly on your device. Only confirmed records and model training tasks coordinate with Render, giving you sub-millisecond responsiveness."
  },
  {
    q: "Can I record transactions and view reports while offline?",
    a: "Yes. The Android mobile application and web app support local-first drafting. When your internet connection is restored, pending drafts synchronize automatically with conflict resolution and idempotency protection."
  },
  {
    q: "Can I import statements from existing banks and accounting software?",
    a: "FinSight supports CSV and Excel imports with drag-and-drop file ingestion, automatic column mapping, preview verification, and intelligent duplicate detection."
  }
];

export function LandingPage({ onLaunchApp, onExploreDemo, onOpenLogin }: LandingPageProps) {
  const [selectedHorizon, setSelectedHorizon] = useState<"30d" | "90d">("30d");
  const [activeFaq, setActiveFaq] = useState<number | null>(null);
  const [scenarioGrowth, setScenarioGrowth] = useState(15);
  const [scenarioHires, setScenarioHires] = useState(2);

  // Live sandbox calculation for hero scenario
  const baseMonthlyRev = 850000;
  const baseMonthlyExp = 520000;
  const simulatedRev = baseMonthlyRev * (1 + scenarioGrowth / 100);
  const simulatedExp = baseMonthlyExp + scenarioHires * 65000;
  const simulatedNet = simulatedRev - simulatedExp;

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#e6edf3] selection:bg-[#1f6feb] selection:text-white">
      {/* Top Banner */}
      <div className="border-b border-[#30363d] bg-[#161b22]/70 px-4 py-2 text-center text-xs text-[#8b949e] backdrop-blur">
        <span className="inline-flex items-center gap-1.5 font-medium text-[#58a6ff]">
          <Sparkles size={13} /> FinSight AI 2.0 with Device-Powered Intelligence & Cloud Sync is now live
        </span>
        <span className="mx-2 hidden sm:inline">·</span>
        <button onClick={onExploreDemo} className="font-semibold text-white underline hover:text-[#58a6ff]">
          Explore Interactive Demo &rarr;
        </button>
      </div>

      {/* Navigation */}
      <header className="sticky top-0 z-50 border-b border-[#30363d]/80 bg-[#0d1117]/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#238636] to-[#2ea043] text-white shadow-lg shadow-[#238636]/20">
              <Activity size={20} strokeWidth={2.5} />
            </div>
            <div>
              <span className="text-base font-bold tracking-tight text-white">FinSight</span>
              <span className="ml-1 rounded bg-[#238636]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[#3fb950] border border-[#238636]/40">AI</span>
            </div>
          </div>

          <nav className="hidden items-center gap-8 text-sm font-medium text-[#8b949e] md:flex">
            <a href="#features" className="transition hover:text-white">Capabilities</a>
            <a href="#forecasting" className="transition hover:text-white">Forecasting</a>
            <a href="#mobile" className="transition hover:text-white">Mobile</a>
            <a href="#security" className="transition hover:text-white">Security</a>
            <a href="#pricing" className="transition hover:text-white">Pricing</a>
            <a href="#faq" className="transition hover:text-white">FAQ</a>
          </nav>

          <div className="flex items-center gap-3">
            <button
              onClick={onOpenLogin}
              className="rounded-lg px-3.5 py-2 text-xs font-semibold text-[#c9d1d9] transition hover:bg-[#21262d] hover:text-white"
            >
              Sign in
            </button>
            <button
              onClick={onLaunchApp}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#238636] px-4 py-2 text-xs font-semibold text-white shadow-md shadow-[#238636]/25 transition hover:bg-[#2ea043]"
            >
              Launch workspace
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-16 pb-20 sm:pt-24 sm:pb-28">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(35,134,54,0.15),transparent)]" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#30363d] bg-[#161b22] px-3.5 py-1.5 text-xs text-[#8b949e]">
              <span className="h-2 w-2 rounded-full bg-[#3fb950] animate-pulse" />
              <span>Next-Gen Corporate Treasury & Predictive Cash Forecasting</span>
            </div>

            <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-6xl sm:leading-[1.12]">
              Precision Financial Control. <br />
              <span className="bg-gradient-to-r from-[#3fb950] via-[#58a6ff] to-[#a371f7] bg-clip-text text-transparent">
                Data-Driven Foresight.
              </span>
            </h1>

            <p className="mt-6 text-base leading-7 text-[#8b949e] sm:text-lg sm:leading-8">
              FinSight AI unites high-precision transaction bookkeeping, cross-validated multi-model financial forecasting, scenario simulation, and device-powered computing into an executive financial command center.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <button
                onClick={onLaunchApp}
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-[#238636] px-6 text-sm font-semibold text-white shadow-xl shadow-[#238636]/30 transition hover:bg-[#2ea043]"
              >
                Start free workspace
                <ArrowRight size={16} />
              </button>
              <button
                onClick={onExploreDemo}
                className="inline-flex h-12 items-center gap-2 rounded-xl border border-[#30363d] bg-[#161b22] px-6 text-sm font-semibold text-[#c9d1d9] transition hover:border-[#8b949e] hover:bg-[#21262d] hover:text-white"
              >
                <Play size={15} className="text-[#3fb950]" />
                Explore live demo workspace
              </button>
            </div>

            <div className="mt-8 flex items-center justify-center gap-6 text-xs text-[#8b949e]">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 size={14} className="text-[#3fb950]" /> No credit card required
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 size={14} className="text-[#3fb950]" /> Decimal-safe accounting
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 size={14} className="text-[#3fb950]" /> Offline-first sync
              </div>
            </div>
          </div>

          {/* Interactive Command Center Showcase */}
          <div className="mt-14 rounded-2xl border border-[#30363d] bg-[#161b22]/90 p-4 shadow-2xl backdrop-blur sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#30363d] pb-4">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-[#f85149]" />
                <div className="h-3 w-3 rounded-full bg-[#d29922]" />
                <div className="h-3 w-3 rounded-full bg-[#3fb950]" />
                <span className="ml-2 text-xs font-semibold text-[#c9d1d9]">FinSight Command Center · Acme Global Technologies</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="rounded-md bg-[#21262d] px-2.5 py-1 text-[#8b949e]">Currency: USD</span>
                <span className="rounded-md bg-[#238636]/20 px-2.5 py-1 font-semibold text-[#3fb950]">Live Sync</span>
              </div>
            </div>

            {/* Top 4 Real-time KPIs */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-4">
                <div className="flex items-center justify-between text-xs text-[#8b949e]">
                  <span>Total Revenue</span>
                  <ArrowUpRight size={14} className="text-[#3fb950]" />
                </div>
                <div className="mt-2 text-xl font-bold text-white">$1,248,500</div>
                <div className="mt-1 text-[11px] text-[#3fb950]">+18.4% vs last period</div>
              </div>

              <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-4">
                <div className="flex items-center justify-between text-xs text-[#8b949e]">
                  <span>Total Expenses</span>
                  <TrendingUp size={14} className="text-[#8b949e]" />
                </div>
                <div className="mt-2 text-xl font-bold text-white">$812,300</div>
                <div className="mt-1 text-[11px] text-[#8b949e]">Controlled burn rate</div>
              </div>

              <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-4">
                <div className="flex items-center justify-between text-xs text-[#8b949e]">
                  <span>Net Cash Flow</span>
                  <Activity size={14} className="text-[#3fb950]" />
                </div>
                <div className="mt-2 text-xl font-bold text-[#3fb950]">+$436,200</div>
                <div className="mt-1 text-[11px] text-[#3fb950]">34.9% Net Cash Margin</div>
              </div>

              <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-4">
                <div className="flex items-center justify-between text-xs text-[#8b949e]">
                  <span>Cash Runway</span>
                  <Clock3 size={14} className="text-[#58a6ff]" />
                </div>
                <div className="mt-2 text-xl font-bold text-white">Healthy</div>
                <div className="mt-1 text-[11px] text-[#58a6ff]">&gt; 18 months reserve</div>
              </div>
            </div>

            {/* Embedded Interactive Chart Preview */}
            <div className="mt-6 rounded-xl border border-[#30363d] bg-[#0d1117] p-4 sm:p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">Revenue Trajectory & 30-Day ML Forecast</div>
                  <div className="text-xs text-[#8b949e]">Actual historical revenue mapped into XGBoost forecast with 90% confidence bands</div>
                </div>
                <div className="flex items-center gap-1.5 rounded-lg border border-[#30363d] bg-[#161b22] p-1 text-xs">
                  <button
                    onClick={() => setSelectedHorizon("30d")}
                    className={`rounded px-2.5 py-1 font-medium transition ${selectedHorizon === "30d" ? "bg-[#238636] text-white" : "text-[#8b949e] hover:text-white"}`}
                  >
                    30 Days
                  </button>
                  <button
                    onClick={() => setSelectedHorizon("90d")}
                    className={`rounded px-2.5 py-1 font-medium transition ${selectedHorizon === "90d" ? "bg-[#238636] text-white" : "text-[#8b949e] hover:text-white"}`}
                  >
                    90 Days
                  </button>
                </div>
              </div>

              <div className="h-[240px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={sampleForecastData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid stroke="#21262d" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="day" stroke="#8b949e" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis stroke="#8b949e" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v / 1000}k`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#161b22", borderColor: "#30363d", borderRadius: 8, fontSize: 12, color: "#fff" }}
                      formatter={(value) => [`$${Number(value).toLocaleString()}`, "Amount"]}
                    />
                    <Area dataKey="upper" stroke="none" fill="#1f6feb" fillOpacity={0.12} />
                    <Area dataKey="lower" stroke="none" fill="#0d1117" fillOpacity={1} />
                    <Line dataKey="actual" stroke="#3fb950" strokeWidth={2.5} dot={{ r: 4, fill: "#3fb950" }} name="Actual Revenue" />
                    <Line dataKey="forecast" stroke="#58a6ff" strokeWidth={2.5} strokeDasharray="5 5" dot={false} name="Forecast" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Product Capabilities Section */}
      <section id="features" className="border-t border-[#30363d] bg-[#161b22]/40 py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-[#3fb950]">Enterprise Financial Architecture</h2>
            <p className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Engineered for Complete Corporate Financial Clarity
            </p>
            <p className="mt-4 text-sm text-[#8b949e]">
              From double-entry bank transfers to multi-model ARIMA/XGBoost cash projections, every capability is tuned for mathematical rigor.
            </p>
          </div>

          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-6 transition hover:border-[#58a6ff]/50">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1f6feb]/20 text-[#58a6ff]">
                <CircleDollarSign size={20} />
              </div>
              <h3 className="mt-4 text-base font-semibold text-white">Full Transaction Management</h3>
              <p className="mt-2 text-xs leading-6 text-[#8b949e]">
                Handle income, expenses, and inter-account transfers with exact decimal arithmetic. Zero floating-point drift, full audit trail, and bulk categorization.
              </p>
            </div>

            <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-6 transition hover:border-[#3fb950]/50">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#238636]/20 text-[#3fb950]">
                <Layers size={20} />
              </div>
              <h3 className="mt-4 text-base font-semibold text-white">Accounts Receivable & Payable Ageing</h3>
              <p className="mt-2 text-xs leading-6 text-[#8b949e]">
                Dedicated AR/AP modules with automated ageing buckets (Current, 1-30, 31-60, 61-90, 90+ days), customer & supplier ledgers, and partial payment posting.
              </p>
            </div>

            <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-6 transition hover:border-[#a371f7]/50">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#8957e5]/20 text-[#a371f7]">
                <Cpu size={20} />
              </div>
              <h3 className="mt-4 text-base font-semibold text-white">Device-Powered Computing</h3>
              <p className="mt-2 text-xs leading-6 text-[#8b949e]">
                Financial KPIs, category analytics, and what-if simulations compute locally on your mobile device or browser. Instant response without waiting for server roundtrips.
              </p>
            </div>

            <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-6 transition hover:border-[#d29922]/50">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#d29922]/20 text-[#d29922]">
                <TrendingUp size={20} />
              </div>
              <h3 className="mt-4 text-base font-semibold text-white">Walk-Forward Cross Validation</h3>
              <p className="mt-2 text-xs leading-6 text-[#8b949e]">
                Evaluates Moving Averages, Exponential Smoothing, Holt-Winters, ARIMA, SARIMA, and Gradient Boosting. Ranks models by real chronological WAPE and MAE.
              </p>
            </div>

            <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-6 transition hover:border-[#f85149]/50">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#da3633]/20 text-[#f85149]">
                <Gauge size={20} />
              </div>
              <h3 className="mt-4 text-base font-semibold text-white">Reserve Breach Forecasting</h3>
              <p className="mt-2 text-xs leading-6 text-[#8b949e]">
                Combines statistical forecasts with due-dated open invoices and recurring obligations to detect cash reserve breaches weeks before they occur.
              </p>
            </div>

            <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-6 transition hover:border-[#58a6ff]/50">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1f6feb]/20 text-[#58a6ff]">
                <Database size={20} />
              </div>
              <h3 className="mt-4 text-base font-semibold text-white">Idempotent Cloud Sync</h3>
              <p className="mt-2 text-xs leading-6 text-[#8b949e]">
                Continuous synchronization between Android, Web, and Render PostgreSQL using monotonic sequence tokens, conflict resolution, and offline draft queues.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive Scenario Sandbox */}
      <section id="forecasting" className="py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
            <div>
              <span className="text-xs font-semibold uppercase tracking-widest text-[#58a6ff]">Interactive What-If Simulation</span>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Test Business Decisions Before Committing Capital
              </h2>
              <p className="mt-4 text-sm leading-7 text-[#8b949e]">
                Adjust revenue growth targets, hiring schedules, and expenditure. FinSight calculates projected net cash flow, runway impact, and reserve safety thresholds instantaneously in memory.
              </p>

              <div className="mt-8 space-y-6">
                <div>
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span className="text-[#c9d1d9]">Projected Revenue Growth</span>
                    <span className="font-bold text-[#3fb950]">+{scenarioGrowth}%</span>
                  </div>
                  <input
                    type="range"
                    min="-20"
                    max="60"
                    step="5"
                    value={scenarioGrowth}
                    onChange={(e) => setScenarioGrowth(Number(e.target.value))}
                    className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-lg bg-[#30363d] accent-[#3fb950]"
                  />
                  <div className="mt-1 flex justify-between text-[10px] text-[#8b949e]">
                    <span>-20% (Contraction)</span>
                    <span>0% (Baseline)</span>
                    <span>+60% (High Growth)</span>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span className="text-[#c9d1d9]">Planned New Hires ($65k/yr each)</span>
                    <span className="font-bold text-[#58a6ff]">{scenarioHires} Headcount</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="10"
                    step="1"
                    value={scenarioHires}
                    onChange={(e) => setScenarioHires(Number(e.target.value))}
                    className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-lg bg-[#30363d] accent-[#58a6ff]"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-[#30363d] bg-[#161b22] p-6 shadow-xl">
              <div className="text-sm font-bold text-white">Simulated Monthly Outcomes</div>
              <div className="mt-1 text-xs text-[#8b949e]">Illustrative client-side calculation; these are sample assumptions.</div>

              <div className="mt-6 grid grid-cols-2 gap-4">
                <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-4">
                  <span className="text-[11px] text-[#8b949e]">Adjusted Monthly Revenue</span>
                  <div className="mt-1 text-lg font-bold text-white">${simulatedRev.toLocaleString()}</div>
                  <span className="text-[10px] text-[#3fb950]">+{scenarioGrowth}% growth</span>
                </div>

                <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-4">
                  <span className="text-[11px] text-[#8b949e]">Adjusted Monthly Spend</span>
                  <div className="mt-1 text-lg font-bold text-white">${simulatedExp.toLocaleString()}</div>
                  <span className="text-[10px] text-[#8b949e]">Incl. +${(scenarioHires * 65000).toLocaleString()} payroll</span>
                </div>

                <div className="col-span-2 rounded-xl border border-[#238636]/40 bg-[#238636]/10 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs text-[#8b949e]">Projected Monthly Net Cash Flow</span>
                      <div className={`text-2xl font-extrabold ${simulatedNet >= 0 ? "text-[#3fb950]" : "text-[#f85149]"}`}>
                        {simulatedNet >= 0 ? "+" : ""}${simulatedNet.toLocaleString()}
                      </div>
                    </div>
                    <span className="rounded-full bg-[#238636]/20 px-3 py-1 text-xs font-semibold text-[#3fb950] border border-[#238636]/40">
                      {simulatedNet >= 0 ? "Cash Accretive" : "Deficit Burn"}
                    </span>
                  </div>
                </div>
              </div>

              <button
                onClick={onLaunchApp}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#238636] py-3 text-xs font-semibold text-white transition hover:bg-[#2ea043]"
              >
                Run full multi-scenario comparison
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Mobile App Showcase Section */}
      <section id="mobile" className="border-t border-[#30363d] bg-[#161b22]/40 py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            <div className="order-2 lg:order-1">
              <div className="mx-auto max-w-sm rounded-[36px] border-4 border-[#30363d] bg-[#0d1117] p-4 shadow-2xl">
                {/* Mobile Screen Mockup */}
                <div className="flex items-center justify-between border-b border-[#30363d] pb-3 text-xs font-semibold text-white">
                  <span>9:41 AM</span>
                  <div className="flex items-center gap-1.5 text-[10px] text-[#3fb950]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#3fb950]" />
                    Local Engine Active
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-3">
                    <span className="text-[10px] text-[#8b949e]">Operating Cash</span>
                    <div className="text-xl font-bold text-white">$482,900</div>
                    <div className="mt-1 flex items-center justify-between text-[10px]">
                      <span className="text-[#3fb950]">+12.4% this month</span>
                      <span className="rounded bg-[#21262d] px-1.5 py-0.5 text-[#8b949e]">USD</span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-3">
                    <div className="flex items-center justify-between text-xs font-semibold text-white">
                      <span>Quick Transaction Draft</span>
                      <span className="text-[10px] text-[#3fb950]">Offline Ready</span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                      <div className="rounded bg-[#0d1117] p-2 text-center text-[#c9d1d9] border border-[#30363d]">Income</div>
                      <div className="rounded bg-[#0d1117] p-2 text-center text-[#c9d1d9] border border-[#30363d]">Expense</div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-3">
                    <span className="text-xs font-semibold text-white">Recent Activity</span>
                    <div className="mt-2 space-y-2 text-xs">
                      <div className="flex justify-between border-b border-[#30363d] pb-1.5">
                        <span className="text-[#c9d1d9]">Client Retainer · Acme</span>
                        <span className="font-semibold text-[#3fb950]">+$24,500</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#c9d1d9]">Cloud Server Infra</span>
                        <span className="font-semibold text-white">-$3,200</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bottom Navigation Mockup */}
                <div className="mt-5 flex justify-around border-t border-[#30363d] pt-3 text-[10px] text-[#8b949e]">
                  <span className="font-bold text-[#3fb950]">Home</span>
                  <span>Ledger</span>
                  <span>Analytics</span>
                  <span>Forecast</span>
                  <span>More</span>
                </div>
              </div>
            </div>

            <div className="order-1 lg:order-2">
              <span className="text-xs font-semibold uppercase tracking-widest text-[#3fb950]">Mobile-First Financial Intelligence</span>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Powerful Android Mobile Application
              </h2>
              <p className="mt-4 text-sm leading-7 text-[#8b949e]">
                FinSight AI delivers a full-fledged native mobile experience built with React Native and Expo. It stores records in a local SQLite database, allowing you to search, calculate KPIs, and draft transactions with zero latency even when flying or off-grid.
              </p>

              <div className="mt-6 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#238636]/20 text-[#3fb950]">
                    <CheckCircle2 size={15} />
                  </div>
                  <span className="text-xs text-[#c9d1d9]">Offline transaction drafts with automatic synchronization when connectivity returns.</span>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#238636]/20 text-[#3fb950]">
                    <CheckCircle2 size={15} />
                  </div>
                  <span className="text-xs text-[#c9d1d9]">Device-powered aggregations: zero waiting for remote servers on mobile dashboards.</span>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#238636]/20 text-[#3fb950]">
                    <CheckCircle2 size={15} />
                  </div>
                  <span className="text-xs text-[#c9d1d9]">Instant receipt & invoice entry, customer receivable tracking, and mobile report sharing.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Security Section */}
      <section id="security" className="py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <span className="text-xs font-semibold uppercase tracking-widest text-[#58a6ff]">Bank-Grade Security</span>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Strict Isolation. Zero Compromises.
            </h2>
            <p className="mt-4 text-sm text-[#8b949e]">
              Built from the ground up for strict regulatory isolation, cryptographic integrity, and compliance.
            </p>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-5 text-center">
              <Lock size={24} className="mx-auto text-[#58a6ff]" />
              <div className="mt-3 text-sm font-bold text-white">Argon2id Hashing</div>
              <p className="mt-1 text-xs text-[#8b949e]">Industry standard memory-hard key derivation protecting user passwords.</p>
            </div>

            <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-5 text-center">
              <ShieldCheck size={24} className="mx-auto text-[#3fb950]" />
              <div className="mt-3 text-sm font-bold text-white">Multi-Tenant Scoping</div>
              <p className="mt-1 text-xs text-[#8b949e]">All SQL queries enforce workspace ownership checks at the ORM layer.</p>
            </div>

            <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-5 text-center">
              <Database size={24} className="mx-auto text-[#a371f7]" />
              <div className="mt-3 text-sm font-bold text-white">Decimal Monetary Math</div>
              <p className="mt-1 text-xs text-[#8b949e]">Guaranteed exact precision using SQL Numeric(16,2) without floating point errors.</p>
            </div>

            <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-5 text-center">
              <Activity size={24} className="mx-auto text-[#d29922]" />
              <div className="mt-3 text-sm font-bold text-white">Tamper-Evident Audit</div>
              <p className="mt-1 text-xs text-[#8b949e]">Every financial creation, update, and deletion is recorded in persistent audit logs.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="border-t border-[#30363d] bg-[#161b22]/40 py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-xs font-semibold uppercase tracking-widest text-[#3fb950]">Predictable Plans</span>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Transparent Pricing for Growing Businesses
            </h2>
            <p className="mt-4 text-sm text-[#8b949e]">
              Start free with the demo workspace or upgrade for multi-seat teams and high-frequency ML forecasts.
            </p>
          </div>

          <div className="mt-12 grid gap-8 lg:grid-cols-3">
            {/* Starter Plan */}
            <div className="rounded-2xl border border-[#30363d] bg-[#0d1117] p-8">
              <div className="text-base font-bold text-white">Starter</div>
              <p className="mt-2 text-xs text-[#8b949e]">For early stage startups and sole proprietors.</p>
              <div className="mt-6 flex items-baseline gap-1">
                <span className="text-3xl font-extrabold text-white">$0</span>
                <span className="text-xs text-[#8b949e]">/ forever free</span>
              </div>
              <ul className="mt-6 space-y-3 text-xs text-[#c9d1d9]">
                <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-[#3fb950]" /> 1 Business Workspace</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-[#3fb950]" /> Unlimited Transactions</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-[#3fb950]" /> 30-Day Financial Forecasting</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-[#3fb950]" /> Android Mobile App Access</li>
              </ul>
              <button
                onClick={onLaunchApp}
                className="mt-8 w-full rounded-xl border border-[#30363d] bg-[#161b22] py-2.5 text-xs font-semibold text-white transition hover:bg-[#21262d]"
              >
                Get Started
              </button>
            </div>

            {/* Growth Plan */}
            <div className="relative rounded-2xl border-2 border-[#238636] bg-[#0d1117] p-8 shadow-xl">
              <span className="absolute -top-3 right-6 rounded-full bg-[#238636] px-3 py-1 text-[10px] font-bold text-white uppercase tracking-wider">
                Popular
              </span>
              <div className="text-base font-bold text-white">Growth</div>
              <p className="mt-2 text-xs text-[#8b949e]">For scaleups needing predictive treasury forecasting.</p>
              <div className="mt-6 flex items-baseline gap-1">
                <span className="text-3xl font-extrabold text-white">$49</span>
                <span className="text-xs text-[#8b949e]">/ month</span>
              </div>
              <ul className="mt-6 space-y-3 text-xs text-[#c9d1d9]">
                <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-[#3fb950]" /> Up to 5 Business Workspaces</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-[#3fb950]" /> 90-Day & 365-Day ML Forecasting</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-[#3fb950]" /> SARIMA & Gradient Boosting Models</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-[#3fb950]" /> Multi-User Team Roles & Audit Logs</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-[#3fb950]" /> PDF & Excel Executive Reports</li>
              </ul>
              <button
                onClick={onLaunchApp}
                className="mt-8 w-full rounded-xl bg-[#238636] py-2.5 text-xs font-semibold text-white shadow-md shadow-[#238636]/25 transition hover:bg-[#2ea043]"
              >
                Start 14-Day Free Trial
              </button>
            </div>

            {/* Enterprise Plan */}
            <div className="rounded-2xl border border-[#30363d] bg-[#0d1117] p-8">
              <div className="text-base font-bold text-white">Enterprise</div>
              <p className="mt-2 text-xs text-[#8b949e]">For mid-market enterprises & financial firms.</p>
              <div className="mt-6 flex items-baseline gap-1">
                <span className="text-3xl font-extrabold text-white">$199</span>
                <span className="text-xs text-[#8b949e]">/ month</span>
              </div>
              <ul className="mt-6 space-y-3 text-xs text-[#c9d1d9]">
                <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-[#3fb950]" /> Unlimited Workspaces & Seats</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-[#3fb950]" /> Dedicated Celery Forecast Workers</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-[#3fb950]" /> Custom Accounting Ingestion API</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-[#3fb950]" /> Custom SLA & Dedicated Engineer</li>
              </ul>
              <button
                onClick={onLaunchApp}
                className="mt-8 w-full rounded-xl border border-[#30363d] bg-[#161b22] py-2.5 text-xs font-semibold text-white transition hover:bg-[#21262d]"
              >
                Contact Sales
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="py-20">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <span className="text-xs font-semibold uppercase tracking-widest text-[#3fb950]">Got Questions?</span>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Frequently Asked Questions
            </h2>
          </div>

          <div className="mt-12 space-y-4">
            {faqs.map((faq, idx) => (
              <div key={idx} className="rounded-xl border border-[#30363d] bg-[#161b22] overflow-hidden">
                <button
                  onClick={() => setActiveFaq(activeFaq === idx ? null : idx)}
                  className="flex w-full items-center justify-between p-5 text-left text-sm font-semibold text-white transition hover:text-[#58a6ff]"
                >
                  <span>{faq.q}</span>
                  <ChevronDown
                    size={18}
                    className={`shrink-0 text-[#8b949e] transition-transform ${activeFaq === idx ? "rotate-180 text-white" : ""}`}
                  />
                </button>
                {activeFaq === idx && (
                  <div className="border-t border-[#30363d] p-5 text-xs leading-6 text-[#8b949e]">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Footer Banner */}
      <section className="border-t border-[#30363d] bg-gradient-to-b from-[#161b22] to-[#0d1117] py-16">
        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">Transform Your Financial Intelligence Today</h2>
          <p className="mx-auto mt-4 max-w-xl text-sm text-[#8b949e]">
            Join thousands of businesses managing runway, cash flow, and forecast scenarios with FinSight AI.
          </p>
          <div className="mt-8 flex justify-center gap-4">
            <button
              onClick={onLaunchApp}
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-[#238636] px-6 text-sm font-semibold text-white shadow-xl shadow-[#238636]/30 transition hover:bg-[#2ea043]"
            >
              Launch FinSight AI
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#30363d] bg-[#0d1117] py-12 text-xs text-[#8b949e]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#238636] text-white">
                <Activity size={14} />
              </div>
              <span className="font-bold text-white">FinSight AI</span>
              <span className="text-[#8b949e]">· Intelligent Financial Ecosystem</span>
            </div>
            <div className="flex gap-6">
              <a href="#features" className="hover:text-white">Capabilities</a>
              <a href="#forecasting" className="hover:text-white">Forecasting</a>
              <a href="#mobile" className="hover:text-white">Android</a>
              <a href="#security" className="hover:text-white">Security</a>
              <a href="#pricing" className="hover:text-white">Pricing</a>
            </div>
            <div>&copy; {new Date().getFullYear()} FinSight AI Platform. All rights reserved.</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
