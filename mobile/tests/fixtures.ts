import { Account, Invoice, OfflineMutation, Session, Snapshot, Transaction } from "../src/types";

export function session(cloud = false, overrides: Partial<Session> = {}): Session {
  return {
    workspaceId: cloud ? "cloud.test.7.41" : "local.test",
    mode: cloud ? "cloud" : "local", apiUrl: cloud ? "https://api.example.com" : null, token: cloud ? "private-token" : null,
    user: { id: cloud ? 7 : -1, name: "Test Owner", email: cloud ? "owner@example.com" : "" },
    business: { id: cloud ? 41 : -1, name: "Test business", currency: "USD", opening_cash: 1000, minimum_reserve: 200 },
    role: "owner", ...overrides,
  };
}
export function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return { id: 1, kind: "income", category: "Sales Revenue", amount: 10, date: "2025-01-30", description: "Recorded sale", payment_method: "Bank", status: "completed", reference: null, account_id: null, to_account_id: null, ...overrides };
}
export function account(overrides: Partial<Account> = {}): Account {
  return { id: 1, name: "Bank", account_type: "bank", currency: "USD", opening_balance: 1000, is_active: true, ...overrides };
}
export function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return { id: 11, direction: "receivable", invoice_number: "INV-11", counterparty: "Customer", issue_date: "2025-01-01", due_date: "2025-01-15", amount: 100, currency: "USD", category: "Sales Revenue", description: "Customer invoice", amount_paid: 0, amount_due: 100, status: "overdue", account_id: null, ...overrides };
}
export function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return { business: session().business, transactions: [], accounts: [], invoices: [], ...overrides };
}
export function mutation(localId: number, overrides: Partial<OfflineMutation> = {}): OfflineMutation {
  const { id: _id, ...data } = transaction();
  return { local_id: localId, client_mutation_id: `mutation-${Math.abs(localId)}`, entity_type: "transaction", action: "create", data, created_at: "2025-01-30T12:00:00Z", ...overrides };
}
