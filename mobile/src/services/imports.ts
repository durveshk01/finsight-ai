import { z } from "zod";
import { Snapshot, TransactionInput } from "../types";
import { toMinor, validDate } from "./money";
import { CURRENCIES, validateTransaction } from "./validation";

const amount = z.number().finite().refine((value) => { try { toMinor(value); return true; } catch { return false; } }, "Money must be finite with at most 2 decimals.");
const date = z.string().refine(validDate, "Use a real YYYY-MM-DD date.");
const id = z.number().int().safe();
const currency = z.enum(CURRENCIES);
const transactionSchema = z.object({
  id, kind: z.enum(["income", "expense", "transfer"]), category: z.string().min(2).max(80), amount: amount.refine((value) => value > 0), date,
  description: z.string().max(240), payment_method: z.string().min(1).max(48), status: z.enum(["completed", "pending", "scheduled"]),
  reference: z.string().max(100).nullable().optional(), account_id: id.nullable().optional(), to_account_id: id.nullable().optional(), invoice_id: id.nullable().optional(),
});
const backupSchema = z.object({
  schema: z.literal("finsight.backup.v1"), snapshot: z.object({
    business: z.object({ id, name: z.string().trim().min(2).max(180), currency, opening_cash: amount, minimum_reserve: amount.refine((value) => value >= 0) }),
    accounts: z.array(z.object({ id, name: z.string().min(2).max(120), account_type: z.enum(["bank", "cash", "card", "wallet"]), currency, opening_balance: amount, is_active: z.boolean() })).max(1000),
    transactions: z.array(transactionSchema).max(20000),
    invoices: z.array(z.object({ id, direction: z.enum(["receivable", "payable"]), invoice_number: z.string().min(1).max(80), counterparty: z.string().min(2).max(180), issue_date: date, due_date: date,
      amount: amount.refine((value) => value > 0), amount_paid: amount.refine((value) => value >= 0), amount_due: amount.refine((value) => value >= 0),
      currency, category: z.string().min(2).max(80), description: z.string().max(240), status: z.enum(["open", "paid", "partially_paid", "overdue"]), account_id: id.nullable().optional(),
    })).max(10000),
  }),
});

export function readBackup(text: string): Snapshot {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("The selected file is not valid JSON."); }
  const result = backupSchema.safeParse(raw);
  if (!result.success) throw new Error(`Invalid FinSight backup: ${result.error.issues[0].path.join(".")} · ${result.error.issues[0].message}`);
  const snapshot = result.data.snapshot;
  for (const records of [snapshot.transactions, snapshot.invoices, snapshot.accounts]) {
    if (new Set(records.map((record) => record.id)).size !== records.length) throw new Error("Backup contains duplicate record IDs.");
  }
  const accounts = new Set(snapshot.accounts.map((account) => account.id));
  const invoices = new Set(snapshot.invoices.map((invoice) => invoice.id));
  for (const account of snapshot.accounts) if (account.currency !== snapshot.business.currency) throw new Error("Backup includes unsupported mixed-currency accounts.");
  for (const invoice of snapshot.invoices) {
    if (invoice.amount_paid > invoice.amount || invoice.due_date < invoice.issue_date || invoice.currency !== snapshot.business.currency) throw new Error("Backup has an invalid invoice balance, date, or currency.");
    if (invoice.account_id != null && !accounts.has(invoice.account_id)) throw new Error("Backup invoice refers to a missing account.");
  }
  for (const transaction of snapshot.transactions) {
    if ((transaction.account_id != null && !accounts.has(transaction.account_id)) || (transaction.to_account_id != null && !accounts.has(transaction.to_account_id))) throw new Error("Backup transaction refers to a missing account.");
    if (transaction.invoice_id != null && !invoices.has(transaction.invoice_id)) throw new Error("Backup payment refers to a missing invoice.");
    if (transaction.kind === "transfer" && (transaction.account_id == null || transaction.to_account_id == null || transaction.account_id === transaction.to_account_id)) throw new Error("Backup transfer requires two different accounts.");
  }
  return snapshot;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index++) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') { value += '"'; index++; }
      else if (quoted || value === "") quoted = !quoted;
      else throw new Error("CSV contains a quote inside an unquoted field.");
    } else if (character === "," && !quoted) { row.push(value); value = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index++;
      row.push(value); if (row.some((cell) => cell.trim())) rows.push(row); row = []; value = "";
    } else value += character;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  row.push(value); if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

export function transactionFingerprint(transaction: TransactionInput): string {
  return JSON.stringify([transaction.date, transaction.kind, toMinor(transaction.amount), transaction.category.trim().toLowerCase(), transaction.description.trim().toLowerCase(), transaction.reference?.trim().toLowerCase() ?? "", transaction.status, transaction.account_id ?? null, transaction.to_account_id ?? null, transaction.payment_method.trim().toLowerCase()]);
}

export interface ImportPreview {
  rows: TransactionInput[];
  duplicateCount: number;
  errors: { row: number; message: string }[];
}

export function previewLedgerCsv(text: string, snapshot: Snapshot): ImportPreview {
  const [header, ...data] = parseCsv(text);
  if (!header || !data.length) throw new Error("CSV needs a header and at least one transaction.");
  if (data.length > 500) throw new Error("Import at most 500 transactions at a time.");
  const columns = header.map((name) => name.trim().toLowerCase());
  if (!["date", "amount", "category"].every((key) => columns.includes(key)) || !columns.some((key) => key === "kind" || key === "type")) throw new Error("Required CSV columns: date, kind (or type), category, amount. Optional: description, status, payment_method, reference, account, to_account.");
  const seen = new Set(snapshot.transactions.map(transactionFingerprint));
  const preview: ImportPreview = { rows: [], duplicateCount: 0, errors: [] };
  data.forEach((cells, index) => {
    try {
      if (cells.length !== columns.length) throw new Error("Column count does not match the CSV header.");
      const record = Object.fromEntries(columns.map((column, columnIndex) => [column, cells[columnIndex].trim()]));
      const rawKind = (record.kind || record.type).toLowerCase();
      const kind = rawKind === "credit" ? "income" : rawKind === "debit" ? "expense" : rawKind;
      if (!["income", "expense", "transfer"].includes(kind)) throw new Error("Type must be income, expense, or transfer.");
      const status = record.status || "completed";
      if (!["completed", "pending", "scheduled"].includes(status)) throw new Error("Status must be completed, pending, or scheduled.");
      const findAccount = (name: string | undefined) => name ? snapshot.accounts.find((account) => account.name.toLowerCase() === name.toLowerCase())?.id : null;
      if ((record.account && findAccount(record.account) == null) || (record.to_account && findAccount(record.to_account) == null)) throw new Error("Account name was not found in this workspace.");
      const transaction = validateTransaction({ kind: kind as TransactionInput["kind"], status: status as TransactionInput["status"], date: record.date,
        amount: Math.abs(toMinor(record.amount)) / 100, category: record.category, description: record.description || "", payment_method: record.payment_method || "Imported",
        reference: record.reference || null, account_id: findAccount(record.account), to_account_id: findAccount(record.to_account),
      }, snapshot);
      const fingerprint = transactionFingerprint(transaction);
      if (seen.has(fingerprint)) preview.duplicateCount++;
      else { seen.add(fingerprint); preview.rows.push(transaction); }
    } catch (error) { preview.errors.push({ row: index + 2, message: error instanceof Error ? error.message : "Invalid row." }); }
  });
  return preview;
}
