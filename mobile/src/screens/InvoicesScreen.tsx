import React, { useState } from "react";
import { Alert, Text, View } from "react-native";
import { Button, Card, Choices, Empty, Field, FormModal, Heading, Notice, Screen, s, useAction } from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { invoiceAgeing } from "../services/financial-engine";
import { addDays, formatCurrency, parseAmount, today, toMinor } from "../services/money";
import { Invoice } from "../types";

function InvoiceEditor({ existing, direction, onClose }: { existing: Invoice | null; direction: Invoice["direction"]; onClose: () => void }) {
  const { snapshot, saveInvoice, deleteInvoice, syncing } = useWorkspace();
  const [type, setType] = useState(existing?.direction ?? direction);
  const [number, setNumber] = useState(existing?.invoice_number ?? "");
  const [counterparty, setCounterparty] = useState(existing?.counterparty ?? "");
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [issueDate, setIssueDate] = useState(existing?.issue_date ?? today());
  const [dueDate, setDueDate] = useState(existing?.due_date ?? addDays(today(), 30));
  const [category, setCategory] = useState(existing?.category ?? (direction === "receivable" ? "Sales Revenue" : "Other Expenses"));
  const [description, setDescription] = useState(existing?.description ?? "");
  const action = useAction();
  if (!snapshot) return null;
  const save = async () => {
    await saveInvoice({ direction: type, invoice_number: number, counterparty, amount: parseAmount(amount), issue_date: issueDate,
      due_date: dueDate, currency: snapshot.business.currency, category, description, account_id: existing?.account_id ?? null }, existing?.id);
    onClose();
  };
  const remove = () => { if (existing) Alert.alert("Delete invoice?", "The unpaid invoice will be removed.", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => void action.run(async () => { await deleteInvoice(existing.id); onClose(); }) }]); };
  return <FormModal visible title={existing ? "Edit invoice" : "Add invoice"} onClose={() => { if (!action.busy) onClose(); }}>
    {action.error ? <Notice text={action.error} error /> : null}
    <Choices label="Direction" options={[{ value: "receivable", label: "Receivable" }, { value: "payable", label: "Payable" }]} selected={type} onSelect={setType} />
    <Field label="Invoice number" testID="invoice-number" value={number} onChangeText={setNumber} maxLength={80} />
    <Field label="Customer or supplier" testID="invoice-counterparty" value={counterparty} onChangeText={setCounterparty} maxLength={180} />
    <Field label={`Invoice amount (${snapshot.business.currency})`} testID="invoice-amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
    <Field label="Issue date (YYYY-MM-DD)" value={issueDate} onChangeText={setIssueDate} maxLength={10} />
    <Field label="Due date (YYYY-MM-DD)" testID="invoice-due-date" value={dueDate} onChangeText={setDueDate} maxLength={10} />
    <Field label="Category" value={category} onChangeText={setCategory} maxLength={80} />
    <Field label="Description" value={description} onChangeText={setDescription} maxLength={240} />
    <Button title="Save invoice" testID="save-invoice" busy={action.busy} disabled={syncing} onPress={() => void action.run(save)} />
    {existing && existing.amount_paid === 0 ? <View style={{ marginTop: 12 }}><Button title="Delete invoice" variant="danger" disabled={action.busy || syncing} onPress={remove} /></View> : null}
  </FormModal>;
}

function PaymentEditor({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const { snapshot, recordPayment, syncing } = useWorkspace();
  const [amount, setAmount] = useState(String(invoice.amount_due));
  const [date, setDate] = useState(today());
  const [method, setMethod] = useState("Bank transfer");
  const [accountId, setAccountId] = useState(invoice.account_id == null ? "none" : String(invoice.account_id));
  const action = useAction();
  if (!snapshot) return null;
  const save = async () => { await recordPayment({ invoice_id: invoice.id, amount: parseAmount(amount), paid_on: date, payment_method: method, account_id: accountId === "none" ? null : Number(accountId) }); onClose(); };
  return <FormModal visible title="Record invoice payment" onClose={() => { if (!action.busy) onClose(); }}>
    <Text style={s.text}>{invoice.invoice_number} · {invoice.counterparty}</Text><Text style={s.muted}>Outstanding: {formatCurrency(invoice.amount_due, invoice.currency)}</Text>
    {action.error ? <Notice text={action.error} error /> : null}
    <Field label={`Payment amount (${invoice.currency})`} testID="payment-amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
    <Field label="Payment date (YYYY-MM-DD)" value={date} onChangeText={setDate} maxLength={10} />
    <Field label="Payment method" value={method} onChangeText={setMethod} maxLength={48} />
    <Choices label="Settlement account" selected={accountId} onSelect={setAccountId} options={[{ value: "none", label: "Unassigned" }, ...snapshot.accounts.filter((account) => account.is_active && account.currency === invoice.currency).map((account) => ({ value: String(account.id), label: account.name }))]} />
    <Notice text="Recording a payment reduces the invoice balance and posts one completed ledger entry. Do not enter the same payment again as a separate transaction." />
    <Button title="Save payment" testID="save-payment" busy={action.busy} disabled={syncing} onPress={() => void action.run(save)} />
  </FormModal>;
}

export function InvoicesScreen() {
  const { snapshot, canWrite, syncing } = useWorkspace();
  const [direction, setDirection] = useState<Invoice["direction"]>("receivable");
  const [search, setSearch] = useState("");
  const [showPaid, setShowPaid] = useState(false);
  const [editor, setEditor] = useState<{ invoice: Invoice | null } | null>(null);
  const [payment, setPayment] = useState<Invoice | null>(null);
  if (!snapshot) return null;
  const all = snapshot.invoices.filter((invoice) => invoice.direction === direction);
  const filtered = all.filter((invoice) => (showPaid || invoice.amount_due > 0) && `${invoice.invoice_number} ${invoice.counterparty}`.toLowerCase().includes(search.toLowerCase().trim()));
  const ageing = invoiceAgeing(all);
  const outstanding = ageing.reduce((sum, bucket) => sum + toMinor(bucket.amount), 0) / 100;
  return <Screen stack>
    <Heading title="Invoices & obligations" subtitle="Actual due dates and outstanding balances" action={canWrite ? <Button title="Add invoice" testID="add-invoice" disabled={syncing} onPress={() => setEditor({ invoice: null })} /> : undefined} />
    <Choices options={[{ value: "receivable", label: "Receivables" }, { value: "payable", label: "Payables" }]} selected={direction} onSelect={setDirection} />
    <Card><Text style={s.label}>TOTAL OUTSTANDING</Text><Text style={s.value}>{formatCurrency(outstanding, snapshot.business.currency)}</Text>
      {ageing.map((bucket) => <View key={bucket.label} style={s.row}><Text style={s.text}>{bucket.label}</Text><Text style={s.text}>{formatCurrency(bucket.amount, snapshot.business.currency)}</Text></View>)}
    </Card>
    <Field label="Search invoices" value={search} onChangeText={setSearch} placeholder="Invoice number, customer, supplier" />
    <Button title={showPaid ? "Hide paid invoices" : "Include paid invoices"} variant="secondary" onPress={() => setShowPaid(!showPaid)} />
    {filtered.length ? filtered.sort((a, b) => a.due_date.localeCompare(b.due_date)).map((invoice) => <Card key={invoice.id}>
      <Text style={s.section}>{invoice.invoice_number}</Text><Text style={s.text}>{invoice.counterparty}</Text>
      <Text style={s.muted}>Due {invoice.due_date} · {invoice.status.replace("_", " ")}{invoice.is_offline_draft ? " · pending sync" : ""}</Text>
      <View style={s.row}><Text style={s.text}>Outstanding</Text><Text testID={`invoice-due-${invoice.invoice_number}`} style={s.text}>{formatCurrency(invoice.amount_due, invoice.currency)}</Text></View>
      <Text style={s.muted}>Paid {formatCurrency(invoice.amount_paid, invoice.currency)} of {formatCurrency(invoice.amount, invoice.currency)}</Text>
      {canWrite ? <View style={s.wrap}><Button title="Edit invoice" variant="secondary" disabled={syncing} onPress={() => setEditor({ invoice })} />
        {invoice.amount_due > 0 ? <Button title="Record payment" testID={`pay-${invoice.invoice_number}`} disabled={syncing} onPress={() => setPayment(invoice)} /> : null}
      </View> : null}
    </Card>) : <Card><Empty text={all.length ? "No invoices match these filters." : "No invoices yet. Add a customer invoice or supplier bill."} /></Card>}
    {editor ? <InvoiceEditor existing={editor.invoice} direction={direction} onClose={() => setEditor(null)} /> : null}
    {payment ? <PaymentEditor invoice={payment} onClose={() => setPayment(null)} /> : null}
  </Screen>;
}
