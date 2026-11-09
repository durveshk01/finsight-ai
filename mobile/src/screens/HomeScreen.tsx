import React from "react";
import { RefreshControl, Text, View } from "react-native";
import { CompositeScreenProps } from "@react-navigation/native";
import { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Button, Card, Empty, Heading, Metric, Notice, Screen, colors, s } from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { calculateMobileKpis, formatCurrency } from "../services/financial-engine";
import { MainTabParamList, RootStackParamList } from "../navigation/RootNavigator";

type Props = CompositeScreenProps<BottomTabScreenProps<MainTabParamList, "Home">, NativeStackScreenProps<RootStackParamList>>;

export function HomeScreen({ navigation }: Props) {
  const { session, snapshot, workspace, syncing, syncNow, canWrite } = useWorkspace();
  if (!session || !snapshot) return null;
  const { business, transactions, invoices } = snapshot;
  const kpis = calculateMobileKpis(transactions, invoices, business.opening_cash, business.minimum_reserve);
  const money = (value: number) => formatCurrency(value, business.currency);
  const refresh = () => { void syncNow(); };
  return <Screen refreshControl={session.mode === "cloud" ? <RefreshControl refreshing={syncing} onRefresh={refresh} tintColor={colors.green} /> : undefined}>
    <Text style={{ color: colors.green, fontSize: 11, fontWeight: "800", letterSpacing: 1.5 }}>FINSIGHT AI · {session.mode.toUpperCase()}</Text>
    <Heading title={business.name} subtitle={`Welcome, ${session.user.name}`} />
    <Notice text={session.mode === "local" ? "Device-only workspace · your records persist on this phone." : syncing ? "Synchronizing with your API…" : workspace?.sync.lastError ? `Cloud unavailable: ${workspace.sync.lastError}` : workspace?.sync.lastSyncTime ? `Last synced ${new Date(workspace.sync.lastSyncTime).toLocaleString()} · ${workspace.queue.length} pending` : "Cloud workspace · awaiting first successful sync."} error={Boolean(workspace?.sync.lastError)} />
    <Card><Text style={s.label}>CURRENT OPERATING CASH</Text><Text testID="current-cash" adjustsFontSizeToFit numberOfLines={1} style={s.value}>{money(kpis.currentCash)}</Text>
      <Text style={s.muted}>Opening cash + completed receipts − completed spending</Text>
      <View style={s.row}><Text style={s.text}>Net cash flow</Text><Text style={[s.text, { color: kpis.netCashFlow >= 0 ? colors.green : colors.red }]}>{money(kpis.netCashFlow)}</Text></View>
    </Card>
    {kpis.currentCash < kpis.minimumReserve ? <Notice error text={`Cash is below your ${money(kpis.minimumReserve)} minimum reserve.`} /> : null}
    <View style={s.wrap}>
      <Metric label="Recorded revenue" value={money(kpis.revenue)} tone={colors.green} />
      <Metric label="Recorded expenses" value={money(kpis.expenses)} />
      <Metric label="Receivables" value={money(kpis.accountsReceivable)} />
      <Metric label="Payables" value={money(kpis.accountsPayable)} />
      <Metric label="Cash runway" value={kpis.cashRunwayDays == null ? "No net burn" : `${kpis.cashRunwayDays} days`} />
      <Metric label="Cash margin" value={`${kpis.cashMarginPct}%`} />
    </View>
    <Text style={s.muted}>Recorded totals include completed entries through today. Runway uses trailing 90-calendar-day net burn.</Text>
    <Button title={canWrite ? "Add transaction" : "View transactions"} testID="home-add-transaction" onPress={() => navigation.navigate("Transactions", { compose: canWrite })} />
    <Heading title="Recent activity" action={<Button title="See all" variant="secondary" onPress={() => navigation.navigate("Transactions")} />} />
    <Card>{transactions.length ? transactions.slice(0, 5).map((transaction) => <View key={transaction.id} style={[s.row, { paddingVertical: 8 }]}>
      <View style={{ flex: 1 }}><Text style={s.text}>{transaction.description || transaction.category}</Text><Text style={s.muted}>{transaction.date} · {transaction.status}{transaction.is_offline_draft ? " · pending sync" : ""}</Text></View>
      <Text style={[s.text, { color: transaction.kind === "income" ? colors.green : colors.text }]}>{transaction.kind === "income" ? "+" : transaction.kind === "expense" ? "−" : "↔"}{money(transaction.amount)}</Text>
    </View>) : <Empty text="No activity yet. Add your first transaction to start your ledger." />}</Card>
  </Screen>;
}
