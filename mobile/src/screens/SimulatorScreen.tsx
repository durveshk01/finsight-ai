import React, { useState } from "react";
import { Text, View } from "react-native";
import { Button, Card, Choices, Field, Heading, Metric, Notice, Screen, colors, s } from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { BASE_SCENARIO, forecastLocal } from "../services/financial-engine";
import { formatCurrency, parseAmount } from "../services/money";
import { ScenarioParams } from "../types";

export function SimulatorScreen() {
  const { snapshot } = useWorkspace();
  const [params, setParams] = useState<ScenarioParams>({ ...BASE_SCENARIO, horizon_days: 90 });
  const [capex, setCapex] = useState("0");
  if (!snapshot) return null;
  let amountError: string | null = null;
  let oneTimeCost = 0;
  try { oneTimeCost = parseAmount(capex || "0", true); } catch { amountError = "Enter a non-negative capital cost with at most 2 decimal places."; }
  const baseline = forecastLocal(snapshot, { ...BASE_SCENARIO, horizon_days: params.horizon_days });
  const result = forecastLocal(snapshot, { ...params, one_time_cost: oneTimeCost });
  const money = (value: number) => formatCurrency(value, snapshot.business.currency);
  const set = (key: keyof ScenarioParams, value: string) => setParams({ ...params, [key]: Number(value) });
  return <Screen stack>
    <Heading title="What-if sandbox" subtitle="Scenario assumptions change projections, never your ledger." />
    <View style={s.wrap}>
      <Button title="Baseline" variant="secondary" onPress={() => { setParams({ ...BASE_SCENARIO, horizon_days: params.horizon_days }); setCapex("0"); }} />
      <Button title="Growth +20%" variant="secondary" onPress={() => setParams({ ...params, revenue_change_pct: 20, expense_change_pct: 10, receivables_delay_days: 0 })} />
      <Button title="Stress −25%" variant="secondary" onPress={() => setParams({ ...params, revenue_change_pct: -25, expense_change_pct: 0, receivables_delay_days: 30 })} />
    </View>
    <Card>
      <Choices label="Horizon" options={[{ value: "30", label: "30 days" }, { value: "90", label: "90 days" }, { value: "180", label: "180 days" }]} selected={String(params.horizon_days)} onSelect={(value) => set("horizon_days", value)} />
      <Choices label="Revenue change" options={[-25, -10, 0, 10, 20, 50].map((value) => ({ value: String(value), label: `${value > 0 ? "+" : ""}${value}%` }))} selected={String(params.revenue_change_pct)} onSelect={(value) => set("revenue_change_pct", value)} />
      <Choices label="Expense change" options={[-20, -10, 0, 10, 20, 30].map((value) => ({ value: String(value), label: `${value > 0 ? "+" : ""}${value}%` }))} selected={String(params.expense_change_pct)} onSelect={(value) => set("expense_change_pct", value)} />
      <Choices label="Receivables delay" options={[0, 15, 30, 60].map((value) => ({ value: String(value), label: `${value} days` }))} selected={String(params.receivables_delay_days)} onSelect={(value) => set("receivables_delay_days", value)} />
      <Choices label="Payables delay" options={[0, 15, 30, 60].map((value) => ({ value: String(value), label: `${value} days` }))} selected={String(params.payables_delay_days)} onSelect={(value) => set("payables_delay_days", value)} />
      <Field label={`One-time capital cost (${snapshot.business.currency})`} testID="scenario-capex" value={capex} onChangeText={setCapex} keyboardType="decimal-pad" />
      {amountError ? <Notice error text={amountError} /> : null}
    </Card>
    {!result.historySufficient ? <Notice text="With insufficient history, growth percentages have no estimated recurring cash flow to change. Invoice timing and capital costs still affect this projection." /> : null}
    <View style={s.wrap}><Metric label="Projected cash" value={money(result.closingCash)} tone={result.closingCash >= snapshot.business.minimum_reserve ? colors.green : colors.red} /><Metric label="Change vs baseline" value={money(result.closingCash - baseline.closingCash)} /></View>
    <Card><Text style={s.section}>{params.horizon_days}-day comparison</Text><View style={s.row}><Text style={s.text}>Baseline ending cash</Text><Text style={s.text}>{money(baseline.closingCash)}</Text></View><View style={s.row}><Text style={s.text}>Scenario ending cash</Text><Text testID="scenario-closing-cash" style={s.text}>{money(result.closingCash)}</Text></View><Text style={s.muted}>Reserve breach: {result.breachDate ?? "none in projection"}</Text></Card>
    <Notice text="Revenue/expense changes apply to estimated recurring daily cash flow. Delays shift confirmed due dates; costs are deducted today. Receipts delayed beyond the horizon are excluded." />
  </Screen>;
}
