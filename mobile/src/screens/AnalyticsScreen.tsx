import React, { useState } from "react";
import { Text, View } from "react-native";
import { Card, Choices, Empty, Heading, Screen, colors, s } from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { calculateCategoryMix, monthlySummary } from "../services/financial-engine";
import { formatCurrency, toMinor } from "../services/money";

export function AnalyticsScreen() {
  const { snapshot } = useWorkspace();
  const [kind, setKind] = useState<"income" | "expense">("expense");
  if (!snapshot) return null;
  const categories = calculateCategoryMix(snapshot.transactions, kind);
  const total = categories.reduce((sum, item) => sum + toMinor(item.amount), 0) / 100;
  const months = monthlySummary(snapshot.transactions).slice(-6);
  const money = (value: number) => formatCurrency(value, snapshot.business.currency);
  return <Screen>
    <Heading title="Financial analytics" subtitle="Computed from completed ledger entries through today" />
    <Choices options={[{ value: "expense", label: "Spending" }, { value: "income", label: "Revenue" }]} selected={kind} onSelect={setKind} />
    <Card><Text style={s.label}>TOTAL RECORDED {kind === "expense" ? "SPENDING" : "REVENUE"}</Text><Text style={s.value}>{money(total)}</Text><Text style={s.muted}>{categories.length} categories · {snapshot.transactions.filter((row) => row.kind === "transfer").length} transfers excluded</Text></Card>
    <Text style={s.section}>Category distribution</Text>
    <Card>{categories.length ? categories.map((category, index) => <View key={category.category} style={{ gap: 8, marginBottom: 14 }}>
      <View style={s.row}><Text style={[s.text, { flex: 1 }]}>{category.category}</Text><Text style={s.text}>{money(category.amount)}</Text></View>
      <View style={{ height: 7, backgroundColor: colors.line, borderRadius: 4, overflow: "hidden" }}><View style={{ width: `${category.sharePct}%`, height: 7, backgroundColor: index % 2 ? colors.blue : colors.green }} /></View>
      <Text style={s.muted}>{category.sharePct}% · {category.count} {category.count === 1 ? "entry" : "entries"}</Text>
    </View>) : <Empty text={`No completed ${kind === "expense" ? "expenses" : "income"} yet.`} />}</Card>
    <Text style={s.section}>Monthly cash flow</Text>
    <Card>{months.length ? months.map((month) => <View key={month.month} style={{ marginBottom: 14 }}>
      <Text style={s.text}>{month.month}</Text><Text style={s.muted}>Revenue {money(month.revenue)} · Expenses {money(month.expenses)}</Text>
      <Text style={[s.text, { color: month.net >= 0 ? colors.green : colors.red }]}>Net {money(month.net)}</Text>
    </View>) : <Empty text="Monthly comparisons appear as you record activity." />}</Card>
  </Screen>;
}
