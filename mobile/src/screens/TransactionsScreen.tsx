import React, { useEffect, useState } from "react";
import { Alert, FlatList, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { Button, Choices, Empty, Field, FormModal, Heading, Notice, colors, s, useAction } from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { formatCurrency, parseAmount, today, validDate } from "../services/money";
import { Transaction, TransactionInput, TransactionKind } from "../types";
import { MainTabParamList } from "../navigation/RootNavigator";

function TransactionEditor({ existing, onClose }: { existing: Transaction | null; onClose: () => void }) {
  const { snapshot, saveTransaction, deleteTransaction, syncing } = useWorkspace();
  const [kind, setKind] = useState<TransactionKind>(existing?.kind ?? "income");
  const [category, setCategory] = useState(existing?.category ?? "Sales Revenue");
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [date, setDate] = useState(existing?.date ?? today());
  const [description, setDescription] = useState(existing?.description ?? "");
  const [status, setStatus] = useState<TransactionInput["status"]>(existing?.status ?? "completed");
  const [accountId, setAccountId] = useState(existing?.account_id == null ? "none" : String(existing.account_id));
  const [toAccountId, setToAccountId] = useState(existing?.to_account_id == null ? "none" : String(existing.to_account_id));
  const [reference, setReference] = useState(existing?.reference ?? "");
  const action = useAction();
  if (!snapshot) return null;
  const accountOptions = [{ value: "none", label: "Unassigned" }, ...snapshot.accounts.filter((account) => account.is_active && account.currency === snapshot.business.currency).map((account) => ({ value: String(account.id), label: account.name }))];
  const save = async () => {
    await saveTransaction({ kind, category, amount: parseAmount(amount), date, description, status,
      payment_method: existing?.payment_method ?? "Mobile entry", reference: reference.trim() || null,
      account_id: accountId === "none" ? null : Number(accountId), to_account_id: kind === "transfer" && toAccountId !== "none" ? Number(toAccountId) : null }, existing?.id);
    onClose();
  };
  const remove = () => {
    if (!existing) return;
    Alert.alert("Delete transaction?", "This removes the entry from your ledger.", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => void action.run(async () => { await deleteTransaction(existing.id); onClose(); }) }]);
  };
  return <FormModal visible title={existing ? "Edit transaction" : "Add transaction"} onClose={() => { if (!action.busy) onClose(); }}>
    {action.error ? <Notice text={action.error} error /> : null}
    <Choices label="Type" options={[{ value: "income", label: "Income" }, { value: "expense", label: "Expense" }, { value: "transfer", label: "Transfer" }]} selected={kind} onSelect={(value) => { setKind(value); if (!existing) setCategory(value === "income" ? "Sales Revenue" : value === "expense" ? "Other Expenses" : "Transfer"); }} />
    <Field label={`Amount (${snapshot.business.currency})`} testID="transaction-amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" />
    <Field label="Category" testID="transaction-category" value={category} onChangeText={setCategory} maxLength={80} />
    <Field label="Description" testID="transaction-description" value={description} onChangeText={setDescription} maxLength={240} />
    <Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} maxLength={10} />
    <Choices label="Status" options={[{ value: "completed", label: "Completed" }, { value: "pending", label: "Pending" }, { value: "scheduled", label: "Scheduled" }]} selected={status} onSelect={setStatus} />
    <Choices label={kind === "transfer" ? "From account" : "Account"} options={accountOptions} selected={accountId} onSelect={setAccountId} />
    {kind === "transfer" ? <Choices label="To account" options={accountOptions} selected={toAccountId} onSelect={setToAccountId} /> : null}
    <Field label="Reference (optional)" value={reference} onChangeText={setReference} maxLength={100} />
    <Button title="Save transaction" testID="save-transaction" busy={action.busy} disabled={syncing} onPress={() => void action.run(save)} />
    {existing ? <View style={{ marginTop: 12 }}><Button title="Delete transaction" variant="danger" disabled={action.busy || syncing} onPress={remove} /></View> : null}
  </FormModal>;
}

export function TransactionsScreen({ navigation, route }: BottomTabScreenProps<MainTabParamList, "Transactions">) {
  const { snapshot, canWrite, syncing } = useWorkspace();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<"all" | TransactionKind>("all");
  const [dateFilters, setDateFilters] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [editor, setEditor] = useState<{ transaction: Transaction | null } | null>(null);
  useEffect(() => {
    if (route.params?.compose) { setEditor({ transaction: null }); navigation.setParams({ compose: false }); }
  }, [route.params?.compose, navigation]);
  if (!snapshot) return null;
  const dateError = (start && !validDate(start)) || (end && !validDate(end)) || (start && end && start > end);
  const filtered = snapshot.transactions.filter((transaction) => {
    const query = search.toLowerCase().trim();
    return (kind === "all" || transaction.kind === kind) &&
      (!query || `${transaction.description} ${transaction.category} ${transaction.reference ?? ""}`.toLowerCase().includes(query)) &&
      (!dateFilters || dateError || ((!start || transaction.date >= start) && (!end || transaction.date <= end)));
  });
  return <SafeAreaView edges={["top", "left", "right"]} style={s.screen}>
    <View style={{ padding: 18 }}><Heading title="Activity ledger" action={canWrite ? <Button title="Add" testID="add-transaction" disabled={syncing} onPress={() => setEditor({ transaction: null })} /> : undefined} />
      <Field label="Search transactions" testID="search-transactions" placeholder="Description, category, reference" value={search} onChangeText={setSearch} />
      <Choices options={[{ value: "all", label: "All" }, { value: "income", label: "Income" }, { value: "expense", label: "Expense" }, { value: "transfer", label: "Transfers" }]} selected={kind} onSelect={setKind} />
      <Button title={dateFilters ? "Hide date filters" : "Filter by date"} variant="secondary" onPress={() => setDateFilters(!dateFilters)} />
      {dateFilters ? <View style={{ marginTop: 12 }}><Field label="From date (YYYY-MM-DD)" value={start} onChangeText={setStart} /><Field label="To date (YYYY-MM-DD)" value={end} onChangeText={setEnd} />{dateError ? <Notice error text="Use valid dates, with the start on or before the end. Filters apply once the dates are valid." /> : null}</View> : null}
      <Text style={s.muted}>{filtered.length} {filtered.length === 1 ? "entry" : "entries"} · {snapshot.business.currency}</Text>
      {!canWrite ? <Text style={s.muted}>Read-only workspace. Cloud editors require a successful permissions sync.</Text> : null}
    </View>
    <FlatList data={filtered} keyExtractor={(transaction) => String(transaction.id)} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 28 }}
      ListEmptyComponent={<Empty text={snapshot.transactions.length ? "No entries match your filters." : "No transactions yet. Tap Add to record your first entry."} />}
      renderItem={({ item }) => <Pressable accessibilityRole={canWrite && !item.invoice_id ? "button" : undefined} accessibilityLabel={`Edit ${item.description || item.category}`} disabled={!canWrite || Boolean(item.invoice_id) || syncing} onPress={() => setEditor({ transaction: item })} style={[s.card, { marginBottom: 10 }]}>
        <View style={s.row}><View style={{ flex: 1 }}><Text style={s.text}>{item.description || item.category}</Text><Text style={s.muted}>{item.category} · {item.date}</Text><Text style={s.muted}>{item.status}{item.is_offline_draft ? " · pending sync" : ""}{item.invoice_id ? " · invoice payment" : ""}</Text></View>
          <Text style={[s.text, { color: item.kind === "income" ? colors.green : item.kind === "expense" ? colors.red : colors.blue }]}>{item.kind === "income" ? "+" : item.kind === "expense" ? "−" : "↔"}{formatCurrency(item.amount, snapshot.business.currency)}</Text>
        </View>
      </Pressable>} />
    {editor ? <TransactionEditor existing={editor.transaction} onClose={() => setEditor(null)} /> : null}
  </SafeAreaView>;
}
