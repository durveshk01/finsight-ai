import React, { useState } from "react";
import { Text, View } from "react-native";
import { Button, Card, Choices, Field, FormModal, Heading, Notice, Screen, s, useAction } from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { accountBalance } from "../services/financial-engine";
import { formatCurrency, parseAmount } from "../services/money";
import { CURRENCIES } from "../services/validation";
import { AccountInput } from "../types";

function AccountEditor({ onClose }: { onClose: () => void }) {
  const { snapshot, createAccount } = useWorkspace();
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountInput["account_type"]>("bank");
  const [balance, setBalance] = useState("0");
  const action = useAction();
  if (!snapshot) return null;
  return <FormModal visible title="Add account" onClose={() => { if (!action.busy) onClose(); }}>
    {action.error ? <Notice error text={action.error} /> : null}
    <Field label="Account name" testID="account-name" value={name} onChangeText={setName} maxLength={120} />
    <Choices label="Account type" options={(["bank", "cash", "card", "wallet"] as const).map((value) => ({ value, label: value }))} selected={type} onSelect={setType} />
    <Field label={`Account opening balance (${snapshot.business.currency})`} value={balance} onChangeText={setBalance} keyboardType="decimal-pad" />
    <Notice text="Account balances allocate your money between accounts. They do not add to consolidated operating cash; set total opening cash separately in workspace settings." />
    <Button title="Save account" testID="save-account" busy={action.busy} onPress={() => void action.run(async () => { await createAccount({ name, account_type: type, currency: snapshot.business.currency, opening_balance: parseAmount(balance || "0", true, true) }); onClose(); })} />
  </FormModal>;
}

export function SettingsScreen() {
  const { snapshot, session, canWrite, syncing, updateBusiness } = useWorkspace();
  const canManageBusiness = session?.role === "owner";
  const [name, setName] = useState(snapshot?.business.name ?? "");
  const [currency, setCurrency] = useState(snapshot?.business.currency ?? "INR");
  const [cash, setCash] = useState(String(snapshot?.business.opening_cash ?? 0));
  const [reserve, setReserve] = useState(String(snapshot?.business.minimum_reserve ?? 0));
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState(false);
  const action = useAction();
  if (!snapshot) return null;
  return <Screen stack>
    <Heading title="Workspace settings" subtitle="Set actual opening cash and your minimum reserve." />
    <Card><Field label="Workspace name" value={name} onChangeText={(value) => { setName(value); setSaved(false); }} editable={canManageBusiness} maxLength={180} />
      {canManageBusiness && !snapshot.transactions.length && !snapshot.invoices.length && !snapshot.accounts.length ? <Choices label="Currency" options={CURRENCIES.map((value) => ({ value, label: value }))} selected={currency} onSelect={setCurrency} /> : <Text style={s.muted}>Currency: {snapshot.business.currency} · fixed after accounts or records are created</Text>}
      <Field label={`Opening cash (${currency})`} testID="settings-opening-cash" value={cash} onChangeText={(value) => { setCash(value); setSaved(false); }} editable={canManageBusiness} keyboardType="decimal-pad" />
      <Field label={`Minimum reserve (${currency})`} testID="settings-reserve" value={reserve} onChangeText={(value) => { setReserve(value); setSaved(false); }} editable={canManageBusiness} keyboardType="decimal-pad" />
      {action.error ? <Notice text={action.error} error /> : null}{saved ? <Notice text="Workspace settings saved." /> : null}
      {canManageBusiness ? <Button title="Save settings" testID="save-settings" disabled={syncing} busy={action.busy} onPress={() => void action.run(async () => { await updateBusiness({ ...snapshot.business, name, currency, opening_cash: parseAmount(cash || "0", true, true), minimum_reserve: parseAmount(reserve || "0", true) }); setSaved(true); })} /> : <Notice text="Only the workspace owner can change business settings." />}
    </Card>
    <Heading title="Accounts" action={canWrite ? <Button title="Add account" testID="add-account" disabled={syncing} onPress={() => setAdding(true)} /> : undefined} />
    <Notice text="Consolidated cash is based on workspace opening cash and operating activity. Account opening balances represent allocations, not additional revenue. Transfers move money between two accounts without changing consolidated cash." />
    {snapshot.accounts.map((account) => <Card key={account.id}><View style={s.row}><Text style={s.section}>{account.name}</Text><Text style={s.text}>{formatCurrency(accountBalance(account, snapshot.transactions), account.currency)}</Text></View><Text style={s.muted}>{account.account_type} · {account.is_active ? "active" : "inactive"}</Text></Card>)}
    {adding ? <AccountEditor onClose={() => setAdding(false)} /> : null}
  </Screen>;
}
