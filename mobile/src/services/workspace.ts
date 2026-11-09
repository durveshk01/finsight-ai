import {
  Account, Business, Invoice, MutationAcknowledgement, OfflineMutation, Session,
  Snapshot, SyncPullResponse, Transaction, WorkspaceData,
} from "../types";
import { today, toMinor } from "./money";

export function emptyWorkspace(session: Session): WorkspaceData {
  return {
    version: 1,
    snapshot: { business: session.business, transactions: [], invoices: [], accounts: [] },
    queue: [],
    nextId: -1,
    sync: { latestSeq: 0, lastSyncTime: null, lastError: null },
  };
}

function upsert<T extends { id: number }>(rows: T[], record: T): T[] {
  return [...rows.filter((row) => row.id !== record.id), record];
}

export function invoiceStatus(invoice: Invoice, asOf = today()): Invoice {
  const due = Math.max(0, toMinor(invoice.amount) - toMinor(invoice.amount_paid)) / 100;
  return { ...invoice, amount_due: due, status: due === 0 ? "paid" : invoice.due_date < asOf ? "overdue" : invoice.amount_paid > 0 ? "partially_paid" : "open" };
}

export function applyMutation(snapshot: Snapshot, mutation: OfflineMutation, draft: boolean): Snapshot {
  const result: Snapshot = {
    ...snapshot,
    transactions: [...snapshot.transactions], accounts: [...snapshot.accounts], invoices: [...snapshot.invoices],
  };
  const id = mutation.entity_id ?? mutation.local_id;
  const record = { ...mutation.data, id, is_offline_draft: draft };
  if (mutation.entity_type === "transaction") {
    result.transactions = mutation.action === "delete"
      ? result.transactions.filter((row) => row.id !== id)
      : upsert(result.transactions, { ...result.transactions.find((row) => row.id === id), ...record } as unknown as Transaction);
  } else if (mutation.entity_type === "account") {
    result.accounts = mutation.action === "delete"
      ? result.accounts.filter((row) => row.id !== id)
      : upsert(result.accounts, { ...record, is_active: mutation.data.is_active ?? true } as unknown as Account);
  } else if (mutation.entity_type === "invoice") {
    if (mutation.action === "delete") result.invoices = result.invoices.filter((row) => row.id !== id);
    else {
      const previous = result.invoices.find((row) => row.id === id);
      result.invoices = upsert(result.invoices, invoiceStatus({ amount_paid: 0, ...previous, ...record } as unknown as Invoice));
    }
  } else if (mutation.entity_type === "payment") {
    const invoice = result.invoices.find((row) => row.id === Number(mutation.data.invoice_id));
    if (!invoice) throw new Error("The invoice for this payment is unavailable.");
    const amount = Number(mutation.data.amount);
    result.invoices = upsert(result.invoices, invoiceStatus({ ...invoice, amount_paid: (toMinor(invoice.amount_paid) + toMinor(amount)) / 100 }));
    result.transactions = upsert(result.transactions, {
      id: mutation.local_id, kind: invoice.direction === "receivable" ? "income" : "expense",
      amount, category: invoice.category, date: String(mutation.data.paid_on), status: "completed",
      description: `Invoice ${invoice.invoice_number}: ${invoice.counterparty}`,
      payment_method: String(mutation.data.payment_method), reference: String(mutation.data.reference || invoice.invoice_number),
      account_id: mutation.data.account_id == null ? invoice.account_id : Number(mutation.data.account_id),
      invoice_id: invoice.id, is_offline_draft: draft,
    });
  } else if (mutation.entity_type === "business") {
    result.business = { ...result.business, ...mutation.data } as Business;
  }
  return result;
}

export function materializeWorkspace(workspace: WorkspaceData): Snapshot {
  const result = workspace.queue.reduce((snapshot, mutation) => applyMutation(snapshot, mutation, true), workspace.snapshot);
  return {
    ...result,
    invoices: result.invoices.map((invoice) => invoiceStatus(invoice)),
    transactions: [...result.transactions].sort((a, b) => b.date.localeCompare(a.date) || a.id - b.id),
  };
}

export function addMutation(workspace: WorkspaceData, mutation: OfflineMutation, cloud: boolean): WorkspaceData {
  return {
    ...workspace,
    nextId: Math.min(workspace.nextId, mutation.local_id - 1),
    queue: cloud ? [...workspace.queue, mutation] : workspace.queue,
    snapshot: cloud ? workspace.snapshot : applyMutation(workspace.snapshot, mutation, false),
  };
}

export function acknowledgeMutation(workspace: WorkspaceData, acknowledgement: MutationAcknowledgement): WorkspaceData {
  const mutation = workspace.queue.find((item) => item.client_mutation_id === acknowledgement.client_mutation_id);
  if (!mutation) return workspace;
  const serverId = mutation.entity_type === "payment" ? acknowledgement.transaction?.id : acknowledgement.entity_id;
  if (serverId == null) throw new Error("The server did not acknowledge the saved record.");
  const referenceKeys = mutation.entity_type === "account" ? ["account_id", "to_account_id"] : mutation.entity_type === "invoice" ? ["invoice_id"] : [];
  const queue = workspace.queue.filter((item) => item !== mutation).map((item) => ({
    ...item,
    entity_id: item.entity_type === mutation.entity_type && item.entity_id === mutation.local_id ? serverId : item.entity_id,
    data: Object.fromEntries(Object.entries(item.data).map(([key, value]) => [key, referenceKeys.includes(key) && value === mutation.local_id ? serverId : value])),
  }));
  const snapshot = { ...workspace.snapshot };
  const record = acknowledgement.record;
  if (mutation.entity_type === "transaction") {
    snapshot.transactions = mutation.action === "delete"
      ? snapshot.transactions.filter((row) => row.id !== acknowledgement.entity_id)
      : upsert(snapshot.transactions, { ...mutation.data, ...record, id: serverId, is_offline_draft: false } as unknown as Transaction);
  } else if (mutation.entity_type === "account") {
    snapshot.accounts = upsert(snapshot.accounts, { ...mutation.data, ...record, id: serverId, is_active: record?.is_active ?? true } as unknown as Account);
  } else if (mutation.entity_type === "invoice") {
    snapshot.invoices = mutation.action === "delete" ? snapshot.invoices.filter((row) => row.id !== acknowledgement.entity_id)
      : upsert(snapshot.invoices, { amount_paid: 0, ...snapshot.invoices.find((row) => row.id === serverId), ...mutation.data, ...record, id: serverId, is_offline_draft: false } as unknown as Invoice);
  } else if (mutation.entity_type === "payment") {
    if (!acknowledgement.invoice || !acknowledgement.transaction) throw new Error("Payment acknowledgement is incomplete.");
    snapshot.invoices = upsert(snapshot.invoices, acknowledgement.invoice);
    snapshot.transactions = upsert(snapshot.transactions, { ...acknowledgement.transaction, invoice_id: acknowledgement.invoice.id });
  } else if (mutation.entity_type === "business") {
    snapshot.business = { ...snapshot.business, ...mutation.data, ...record } as Business;
  }
  return { ...workspace, snapshot, queue };
}

export function applyPull(workspace: WorkspaceData, response: SyncPullResponse): WorkspaceData {
  let snapshot = { ...workspace.snapshot, business: response.business };
  if (response.mode === "baseline") {
    if (!response.data) throw new Error("The server returned an incomplete workspace snapshot.");
    snapshot = { ...snapshot, ...response.data };
  } else {
    for (const change of response.changes ?? []) {
      const data = (change.data.after as Record<string, unknown> | undefined) ?? change.data;
      if (["transaction", "account", "invoice", "business"].includes(change.entity_type)) {
        snapshot = applyMutation(snapshot, {
          client_mutation_id: "remote", entity_type: change.entity_type as OfflineMutation["entity_type"],
          action: change.action === "delete" ? "delete" : "update", entity_id: change.entity_id,
          local_id: change.entity_id, data, created_at: "",
        }, false);
      }
    }
  }
  return { ...workspace, snapshot, sync: { ...workspace.sync, latestSeq: response.new_seq ?? response.latest_seq } };
}
