import React, { useState } from "react";
import { Text, View } from "react-native";
import Svg, { Line, Polyline } from "react-native-svg";
import { Card, Choices, Heading, Metric, Notice, Screen, colors, s } from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { BASE_SCENARIO, forecastLocal } from "../services/financial-engine";
import { formatCurrency } from "../services/money";

export function ForecastsScreen() {
  const { snapshot } = useWorkspace();
  const [horizon, setHorizon] = useState("30");
  if (!snapshot) return null;
  const forecast = forecastLocal(snapshot, { ...BASE_SCENARIO, horizon_days: Number(horizon) });
  const values = [forecast.openingCash, ...forecast.days.map((day) => day.balance), snapshot.business.minimum_reserve];
  const minimum = Math.min(...values);
  const range = Math.max(1, Math.max(...values) - minimum);
  const y = (value: number) => 144 - (value - minimum) / range * 128;
  const line = [forecast.openingCash, ...forecast.days.map((day) => day.balance)].map((balance, index, rows) => `${index / (rows.length - 1) * 300},${y(balance)}`).join(" ");
  const money = (value: number) => formatCurrency(value, snapshot.business.currency);
  return <Screen>
    <Heading title="Cash-flow outlook" subtitle="On-device projection from your ledger and confirmed obligations" />
    <Choices options={[{ value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} selected={horizon} onSelect={setHorizon} />
    {!forecast.historySufficient ? <Notice text={`Insufficient history for a statistical trend (${forecast.historyDays} calendar days). This outlook includes only known invoices and pending/scheduled entries. Add at least 6 completed entries spanning 14 days for moving-average model evaluation.`} /> : <Notice text="Moving-average candidates are evaluated on chronological one-day-ahead holdouts. Projections are estimates, not guaranteed receipts or a cloud ML forecast." />}
    <Card><Text style={s.label}>PROJECTED ENDING CASH · DAY {horizon}</Text><Text testID="forecast-closing-cash" style={s.value}>{money(forecast.closingCash)}</Text><Text style={s.muted}>Revenue model: {forecast.model}</Text>
      <Svg width="100%" height={170} viewBox="0 0 300 160" accessibilityLabel="Projected cash balance chart">
        <Line x1={0} x2={300} y1={y(snapshot.business.minimum_reserve)} y2={y(snapshot.business.minimum_reserve)} stroke={colors.red} strokeDasharray="4 4" />
        <Polyline points={line} fill="none" stroke={colors.green} strokeWidth={2.5} />
      </Svg><Text style={s.muted}>Green: projected cash · Red: minimum reserve ({money(snapshot.business.minimum_reserve)})</Text>
    </Card>
    <View style={s.wrap}><Metric label="Projected inflows" value={money(forecast.projectedRevenue)} /><Metric label="Projected outflows" value={money(forecast.projectedExpenses)} /></View>
    <Notice error={Boolean(forecast.breachDate)} text={forecast.breachDate ? `Projected reserve breach: ${forecast.breachDate}. Minimum projected cash: ${money(forecast.minimumCash)}.` : `No reserve breach in this projection. Minimum projected cash: ${money(forecast.minimumCash)}. Unknown future costs are not included.`} />
    {forecast.metrics.length ? <><Text style={s.section}>Revenue model holdout results</Text><Card>{forecast.metrics.map((metric) => <View key={metric.model} style={{ paddingVertical: 8 }}><Text style={s.text}>{metric.model}{metric.selected ? " · selected" : ""}</Text><Text style={s.muted}>MAE {money(metric.mae)} · WAPE {metric.wape == null ? "not defined (zero holdout revenue)" : `${metric.wape}%`}</Text></View>)}</Card></> : null}
    <Text style={s.section}>Projection checkpoints</Text><Card>{forecast.days.filter((_, index) => index === 0 || (index + 1) % 7 === 0 || index === forecast.days.length - 1).map((day) => <View key={day.date} style={s.row}><Text style={s.text}>{day.date}</Text><Text style={s.text}>{money(day.balance)}</Text></View>)}</Card>
  </Screen>;
}
