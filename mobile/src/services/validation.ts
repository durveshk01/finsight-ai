import { InvoiceInput, PaymentInput, Snapshot, TransactionInput } from "../types";
import { today, toMinor, validDate } from "./money";

export const CURRENCIES = ["INR", "USD", "EUR", "GBP", "CAD", "AUD", "SGD", "AED"] as const;

export function requireText(value: string, label: string, minimum = 2, maximum = 180): string {
  const cleaned = value.trim();
  if (cleaned.length < minimum || cleaned.length > maximum) throw new Error(`${label} must contain ${minimum}–${maximum} characters.`);
  return cleaned;
}

function ownedAccount(snapshot: Snapshot, accountId: number | null | undefined) {
  if (accountId != null && !snapshot.accounts.some((account) => account.id === accountId && account.is_active && account.currency === snapshot.business.currency)) {
    throw new Error("Select an active account in this workspace and currency.");
  }
}

export function validateTransaction(input: TransactionInput, snapshot: Snapshot): TransactionInput {
  if (!["income", "expense", "transfer"].includes(input.kind) || !["completed", "pending", "scheduled"].includes(input.status)) throw new Error("Select a valid transaction type and status.");
  if (toMinor(input.amount) <= 0) throw new Error("Amount must be greater than zero.");
  if (!validDate(input.date)) throw new Error("Enter a real date in YYYY-MM-DD format.");
  if (input.status === "completed" && input.date > today()) throw new Error("Use Scheduled for a transaction dated in the future.");
  ownedAccount(snapshot, input.account_id);
  ownedAccount(snapshot, input.to_account_id);
  if (input.kind === "transfer" && (input.account_id == null || input.to_account_id == null || input.account_id === input.to_account_id)) throw new Error("A transfer requires two different accounts.");
  if (input.kind !== "transfer" && input.to_account_id != null) throw new Error("A destination account is only valid for transfers.");
  return { ...input, category: requireText(input.category, "Category", 2, 80), description: input.description.trim().slice(0, 240), payment_method: requireText(input.payment_method, "Payment method", 1, 48) };
}

export function validateInvoice(input: InvoiceInput, snapshot: Snapshot, existingId?: number): InvoiceInput {
  if (toMinor(input.amount) <= 0) throw new Error("Invoice amount must be greater than zero.");
  if (!validDate(input.issue_date) || !validDate(input.due_date) || input.due_date < input.issue_date) throw new Error("Use valid YYYY-MM-DD dates; the due date must be on or after the issue date.");
  if (input.currency !== snapshot.business.currency) throw new Error("Invoice currency must match the workspace; currency conversion is not supported.");
  ownedAccount(snapshot, input.account_id);
  const number = requireText(input.invoice_number, "Invoice number", 1, 80);
  if (snapshot.invoices.some((invoice) => invoice.id !== existingId && invoice.invoice_number.toLowerCase() === number.toLowerCase())) throw new Error("This invoice number already exists.");
  return { ...input, invoice_number: number, counterparty: requireText(input.counterparty, "Customer or supplier", 2, 180), category: requireText(input.category, "Category", 2, 80), description: input.description.trim().slice(0, 240) };
}

export function validatePayment(input: PaymentInput, snapshot: Snapshot): PaymentInput {
  const invoice = snapshot.invoices.find((row) => row.id === input.invoice_id);
  if (!invoice) throw new Error("Invoice not found.");
  const minor = toMinor(input.amount);
  if (minor <= 0 || minor > toMinor(invoice.amount_due)) throw new Error("Payment must be positive and cannot exceed the outstanding amount.");
  if (!validDate(input.paid_on) || input.paid_on > today()) throw new Error("Use a valid settlement date that is not in the future.");
  if (invoice.currency !== snapshot.business.currency) throw new Error("Foreign-currency settlement is not supported.");
  ownedAccount(snapshot, input.account_id);
  return { ...input, payment_method: requireText(input.payment_method, "Payment method", 1, 48) };
}
