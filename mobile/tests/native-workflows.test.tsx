import React from "react";
import { act, fireEvent, fireEventAsync, render, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import App from "../App";
import { WorkspaceProvider, useWorkspace } from "../src/context/WorkspaceContext";
import { InvoicesScreen } from "../src/screens/InvoicesScreen";
import { calculateMobileKpis } from "../src/services/financial-engine";
import { MobileStorage } from "../src/services/storage";
import { invoice, session, snapshot, transaction } from "./fixtures";

async function openProvider(children: React.ReactNode = null, initial = session()) {
  let current!: ReturnType<typeof useWorkspace>;
  function Probe() { current = useWorkspace(); return null; }
  const view = render(<WorkspaceProvider><Probe />{children}</WorkspaceProvider>);
  await waitFor(() => expect(current.loading).toBe(false));
  await act(async () => { await current.openSession(initial); });
  return { ...view, state: () => current };
}

test("real startup, local creation, tab navigation and transaction form update actual cash", async () => {
  const view = render(<App />);
  fireEvent.press(await view.findByTestId("create-local-workspace"));
  fireEvent.changeText(view.getByTestId("owner-name"), "Device Owner");
  fireEvent.changeText(view.getByTestId("workspace-name"), "Native verified business");
  fireEvent.changeText(view.getByTestId("opening-cash"), "1000");
  await fireEventAsync.press(view.getByTestId("submit-auth"));
  expect(await view.findByTestId("current-cash")).toHaveTextContent(/1,000\.00/);
  fireEvent.press(view.getByTestId("home-add-transaction"));
  fireEvent.changeText(await view.findByTestId("transaction-amount"), "125.35");
  fireEvent.changeText(view.getByTestId("transaction-description"), "Verified receipt");
  await fireEventAsync.press(view.getByTestId("save-transaction"));
  await waitFor(() => expect(view.queryByTestId("save-transaction")).toBeNull());
  expect(await view.findByText("Verified receipt")).toBeTruthy();
  fireEvent.changeText(view.getByTestId("search-transactions"), "not present");
  expect(view.getByText("No entries match your filters.")).toBeTruthy();
  fireEvent.press(view.getByTestId("tab-home"));
  expect(await view.findByTestId("current-cash")).toHaveTextContent(/1,125\.35/);
});

test("invoice form rejects overpayment and rapid payment taps post exactly one receipt", async () => {
  const view = await openProvider(<InvoicesScreen />);
  fireEvent.press(view.getByTestId("add-invoice"));
  fireEvent.changeText(view.getByTestId("invoice-number"), "UI-100");
  fireEvent.changeText(view.getByTestId("invoice-counterparty"), "Actual customer");
  fireEvent.changeText(view.getByTestId("invoice-amount"), "100.50");
  await fireEventAsync.press(view.getByTestId("save-invoice"));
  await waitFor(() => expect(view.queryByTestId("save-invoice")).toBeNull());
  fireEvent.press(view.getByTestId("pay-UI-100"));
  fireEvent.changeText(view.getByTestId("payment-amount"), "101");
  await fireEventAsync.press(view.getByTestId("save-payment"));
  expect(await view.findByText("Payment must be positive and cannot exceed the outstanding amount.")).toBeTruthy();
  expect(view.state().snapshot!.transactions).toHaveLength(0);
  fireEvent.changeText(view.getByTestId("payment-amount"), "30.25");
  const submit = view.getByTestId("save-payment");
  await act(async () => {
    fireEvent.press(submit);
    fireEvent.press(submit);
  });
  await waitFor(() => expect(view.queryByTestId("save-payment")).toBeNull());
  expect(view.getByTestId("invoice-due-UI-100")).toHaveTextContent(/70\.25/);
  expect(view.state().snapshot!.transactions).toHaveLength(1);
  expect(view.state().snapshot!.transactions[0].amount).toBe(30.25);
});

test("provider CRUD, transfers and partial payments survive closing and restarting", async () => {
  const view = await openProvider();
  await act(async () => {
    await view.state().createAccount({ name: "Bank", account_type: "bank", currency: "USD", opening_balance: 1000 });
    await view.state().createAccount({ name: "Cash", account_type: "cash", currency: "USD", opening_balance: 0 });
    await view.state().saveTransaction(transaction({ kind: "transfer", amount: 500, account_id: -1, to_account_id: -2 }));
    await view.state().saveInvoice(invoice({ invoice_number: "PERSIST-1" }));
  });
  const invoiceId = view.state().snapshot!.invoices[0].id;
  await act(async () => { await view.state().recordPayment({ invoice_id: invoiceId, amount: 40, paid_on: "2025-01-31", payment_method: "Bank", account_id: -1 }); });
  const paymentId = view.state().snapshot!.transactions.find((row) => row.invoice_id === invoiceId)!.id;
  await expect(view.state().deleteTransaction(paymentId)).rejects.toThrow(/Invoice payments/);
  await expect(view.state().deleteInvoice(invoiceId)).rejects.toThrow(/payments/);
  expect(calculateMobileKpis(view.state().snapshot!.transactions, view.state().snapshot!.invoices, 1000, 200).currentCash).toBe(1040);
  const local = view.state().session!;
  await act(async () => { await view.state().signOut(); });
  expect(view.state().session).toBeNull();
  view.unmount();
  const restarted = await openProvider(null, (await MobileStorage.getLocalSession())!);
  expect(restarted.state().snapshot!.transactions).toHaveLength(2);
  expect(restarted.state().snapshot!.invoices[0].amount_due).toBe(60);
  expect(restarted.state().session!.workspaceId).toBe(local.workspaceId);
  await act(async () => { await restarted.state().saveTransaction(transaction({ amount: 25 })); });
  const row = restarted.state().snapshot!.transactions.find((entry) => !entry.invoice_id && entry.kind === "income")!;
  await act(async () => {
    await restarted.state().saveTransaction({ ...row, amount: 26 }, row.id);
    await restarted.state().deleteTransaction(row.id);
  });
  expect(restarted.state().snapshot!.transactions).toHaveLength(2);
});

test("backup restore opens a new local workspace and retains the previous cloud cache", async () => {
  const cloud = session(true);
  const view = await openProvider(null, cloud);
  await act(async () => { await view.state().restoreBackup(snapshot({ transactions: [transaction({ amount: 77 })] })); });
  expect(view.state().session).toMatchObject({ mode: "local", token: null, apiUrl: null, role: "owner" });
  expect(view.state().session!.workspaceId).not.toBe(cloud.workspaceId);
  expect(view.state().snapshot!.transactions[0].amount).toBe(77);
  expect((await MobileStorage.getWorkspace(cloud)).snapshot.business.id).toBe(cloud.business.id);
  expect(await SecureStore.getItemAsync("finsight.v2.token")).toBeNull();
});

test("viewer editors and non-owner business settings are rejected before anything is queued", async () => {
  const view = await openProvider(null, session(true, { role: "viewer" }));
  expect(view.state().canWrite).toBe(false);
  await expect(view.state().saveTransaction(transaction())).rejects.toThrow(/read-only/);
  await act(async () => { await view.state().openSession(session(true, { role: "accountant" })); });
  await expect(view.state().updateBusiness(session(true).business)).rejects.toThrow(/owner/);
  expect(view.state().workspace!.queue).toHaveLength(0);
});
