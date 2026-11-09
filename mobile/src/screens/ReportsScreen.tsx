import React, { useState } from "react";
import { Alert, Text, View } from "react-native";
import { File } from "expo-file-system";
import * as DocumentPicker from "expo-document-picker";
import { Button, Card, Choices, Heading, Notice, Screen, s, useAction } from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { calculateCategoryMix, calculateMobileKpis } from "../services/financial-engine";
import { ImportPreview, previewLedgerCsv, readBackup } from "../services/imports";
import { shareExport } from "../services/report-files";
import { formatCurrency } from "../services/money";

export function ReportsScreen() {
  const { snapshot, session, canWrite, syncing, importTransactions, restoreBackup } = useWorkspace();
  const [tab, setTab] = useState("cash");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const action = useAction();
  if (!snapshot || !session) return null;
  const kpis = calculateMobileKpis(snapshot.transactions, snapshot.invoices, snapshot.business.opening_cash, snapshot.business.minimum_reserve);
  const categories = calculateCategoryMix(snapshot.transactions, "expense");
  const money = (value: number) => formatCurrency(value, snapshot.business.currency);
  const pick = async (type: string | string[]) => {
    const result = await DocumentPicker.getDocumentAsync({ type, copyToCacheDirectory: true });
    if (result.canceled) return null;
    const file = new File(result.assets[0].uri);
    if (file.size > 5 * 1024 * 1024) throw new Error("Choose a file smaller than 5 MB.");
    return file.text();
  };
  const importCsv = async () => { const text = await pick(["text/csv", "text/comma-separated-values", "application/octet-stream"]); if (text) setPreview(previewLedgerCsv(text, snapshot)); };
  const restore = async () => {
    const text = await pick(["application/json", "text/plain", "application/octet-stream"]);
    if (!text) return;
    const data = readBackup(text);
    Alert.alert("Open backup locally?", `${data.business.name}: ${data.transactions.length} transactions and ${data.invoices.length} invoices. This creates a new local workspace; your current workspace is retained.`, [{ text: "Cancel", style: "cancel" }, { text: "Open backup", onPress: () => void action.run(() => restoreBackup(data)) }]);
  };
  return <Screen stack>
    <Heading title="Reports & exports" subtitle={`${snapshot.business.name} · ${snapshot.business.currency}`} />
    <Choices options={[{ value: "cash", label: "Cash position" }, { value: "income", label: "Cash-basis summary" }, { value: "expenses", label: "Expense categories" }]} selected={tab} onSelect={setTab} />
    <Card>
      {tab === "cash" ? <>{[["Operating cash", kpis.currentCash], ["Receivables", kpis.accountsReceivable], ["Payables", kpis.accountsPayable], ["Working capital", kpis.workingCapital], ["Minimum reserve", kpis.minimumReserve]].map(([label, amount]) => <View key={String(label)} style={s.row}><Text style={s.text}>{label}</Text><Text style={s.text}>{money(Number(amount))}</Text></View>)}<Text style={s.muted}>Runway: {kpis.cashRunwayDays == null ? "no trailing net burn" : `${kpis.cashRunwayDays} days`}</Text></> : tab === "income" ? <>{[["Completed revenue", kpis.revenue], ["Completed expenses", kpis.expenses], ["Net cash flow", kpis.netCashFlow]].map(([label, amount]) => <View key={String(label)} style={s.row}><Text style={s.text}>{label}</Text><Text style={s.text}>{money(Number(amount))}</Text></View>)}<Text style={s.muted}>Cash margin: {kpis.cashMarginPct}%</Text></> : categories.length ? categories.map((category) => <View key={category.category} style={s.row}><View style={{ flex: 1 }}><Text style={s.text}>{category.category}</Text><Text style={s.muted}>{category.count} entries · {category.sharePct}%</Text></View><Text style={s.text}>{money(category.amount)}</Text></View>) : <Text style={s.muted}>No completed expenses recorded.</Text>}
    </Card>
    <Notice text="These cash-basis management reports use records on this device, including pending sync changes. They are not an audited accrual P&L or a tax filing." />
    {action.error ? <Notice text={action.error} error /> : null}{notice ? <Notice text={notice} /> : null}
    <Text style={s.section}>Share real files</Text>
    {(["pdf", "xlsx", "csv", "json"] as const).map((format) => <Button key={format} title={format === "json" ? "Export workspace backup (JSON)" : `Export ${format === "xlsx" ? "Excel workbook" : format.toUpperCase()}`} testID={`export-${format}`} variant="secondary" busy={action.busy} onPress={() => void action.run(() => shareExport(snapshot, session.mode, format))} />)}
    <Text style={s.muted}>PDF: financial summary · Excel: summary, ledger, invoices, monthly totals · CSV: ledger · JSON: portable workspace backup. Files are generated locally and shared using the Android share sheet. Backups contain financial data, never passwords or bearer tokens.</Text>
    {canWrite ? <Button title="Import ledger CSV" variant="secondary" disabled={syncing} busy={action.busy} onPress={() => void action.run(importCsv)} /> : null}
    <Button title="Open backup as local workspace" variant="secondary" disabled={syncing} busy={action.busy} onPress={() => void action.run(restore)} />
    {preview ? <Card><Text style={s.section}>CSV import preview</Text><Text style={s.text}>{preview.rows.length} valid new entries · {preview.duplicateCount} duplicates skipped · {preview.errors.length} invalid rows</Text>
      {preview.errors.slice(0, 10).map((error) => <Text key={error.row} style={s.muted}>Row {error.row}: {error.message}</Text>)}
      {preview.rows.slice(0, 10).map((row, index) => <Text key={index} style={s.muted}>{row.date} · {row.category} · {money(row.amount)}</Text>)}
      <Button title="Confirm valid CSV entries" disabled={!preview.rows.length || syncing} busy={action.busy} onPress={() => void action.run(async () => { const count = await importTransactions(preview.rows); setNotice(`Imported ${count} entries; duplicates and invalid rows were skipped.`); setPreview(null); })} />
      <Button title="Cancel import" variant="secondary" disabled={action.busy} onPress={() => setPreview(null)} />
    </Card> : null}
  </Screen>;
}
