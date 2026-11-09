import { strToU8, zipSync } from "fflate";
import { Snapshot } from "../types";
import { calculateMobileKpis, monthlySummary } from "./financial-engine";
import { formatCurrency, today } from "./money";

export function escapeXml(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function csvCell(value: string | number): string {
  let text = String(value);
  if (typeof value === "string" && /^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function ledgerRows(snapshot: Snapshot): (string | number)[][] {
  const accountName = (id: number | null | undefined) => snapshot.accounts.find((account) => account.id === id)?.name ?? "";
  return [["date", "kind", "category", "amount", "description", "payment_method", "status", "reference", "account", "to_account"],
    ...snapshot.transactions.map((transaction) => [transaction.date, transaction.kind, transaction.category, transaction.amount,
      transaction.description, transaction.payment_method, transaction.status, transaction.reference ?? "", accountName(transaction.account_id), accountName(transaction.to_account_id)])];
}

export function ledgerCsv(snapshot: Snapshot): string {
  return "\uFEFF" + ledgerRows(snapshot).map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function reportHtml(snapshot: Snapshot, mode: string): string {
  const business = snapshot.business;
  const kpis = calculateMobileKpis(snapshot.transactions, snapshot.invoices, business.opening_cash, business.minimum_reserve);
  const money = (value: number) => escapeXml(formatCurrency(value, business.currency));
  const rows = [["Completed revenue", kpis.revenue], ["Completed expenses", kpis.expenses], ["Net operating cash flow", kpis.netCashFlow], ["Current operating cash", kpis.currentCash], ["Accounts receivable", kpis.accountsReceivable], ["Accounts payable", kpis.accountsPayable], ["Working capital", kpis.workingCapital], ["Minimum reserve", kpis.minimumReserve]] as const;
  return `<!doctype html><html><head><meta charset="UTF-8"><style>
    body{font-family:Arial,sans-serif;color:#18212c;padding:32px;font-size:12px}h1{color:#167654}table{width:100%;border-collapse:collapse;margin:20px 0}td,th{padding:10px;border-bottom:1px solid #ddd;text-align:left}td:last-child{text-align:right}.note{color:#586474;line-height:1.7}h2{margin-top:28px}
    </style></head><body><h1>FinSight AI · Financial summary</h1><h2>${escapeXml(business.name)}</h2>
    <p>${escapeXml(today())} · ${escapeXml(business.currency)} · ${escapeXml(mode)} workspace</p>
    <table>${rows.map(([label, value]) => `<tr><td>${escapeXml(label)}</td><td>${money(value)}</td></tr>`).join("")}</table>
    <h2>Monthly cash-basis summary</h2><table><tr><th>Month</th><th>Revenue</th><th>Expenses</th><th>Net</th></tr>${monthlySummary(snapshot.transactions).map((month) => `<tr><td>${month.month}</td><td>${money(month.revenue)}</td><td>${money(month.expenses)}</td><td>${money(month.net)}</td></tr>`).join("")}</table>
    <h2>Invoices</h2><table><tr><th>Number</th><th>Counterparty</th><th>Due date</th><th>Outstanding</th></tr>${snapshot.invoices.map((invoice) => `<tr><td>${escapeXml(invoice.invoice_number)}</td><td>${escapeXml(invoice.counterparty)}</td><td>${invoice.due_date}</td><td>${money(invoice.amount_due)}</td></tr>`).join("")}</table>
    <p class="note">This is a cash-basis management summary of records on this device, including any unacknowledged local changes. It is not an audited accrual P&amp;L or tax return. Transfers do not count as income or expense. Opening cash is added once; account opening balances do not add to consolidated cash. No statement of cloud connectivity is inferred from this report.</p></body></html>`;
}

type Sheet = { name: string; rows: (string | number)[][] };

// Minimal standards-based OOXML workbook. Cells are values/inline strings, never formulas.
// This keeps Excel exports available offline without bundling a server or Node-only workbook engine.
export function workbookBytes(sheets: Sheet[]): Uint8Array {
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const files: Record<string, Uint8Array> = {};
  files["[Content_Types].xml"] = strToU8(`${declaration}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`);
  files["_rels/.rels"] = strToU8(`${declaration}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  files["xl/workbook.xml"] = strToU8(`${declaration}<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets>${sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`);
  files["xl/_rels/workbook.xml.rels"] = strToU8(`${declaration}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}</Relationships>`);
  sheets.forEach((sheet, index) => {
    const column = (value: number): string => value < 26 ? String.fromCharCode(65 + value) : column(Math.floor(value / 26) - 1) + column(value % 26);
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(`${declaration}<worksheet xmlns="${ns}"><sheetData>${sheet.rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((cell, cellIndex) => typeof cell === "number"
      ? `<c r="${column(cellIndex)}${rowIndex + 1}" t="n"><v>${cell}</v></c>`
      : `<c r="${column(cellIndex)}${rowIndex + 1}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell)}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`);
  });
  return zipSync(files, { level: 6 });
}

export function financialWorkbook(snapshot: Snapshot): Uint8Array {
  const business = snapshot.business;
  const kpis = calculateMobileKpis(snapshot.transactions, snapshot.invoices, business.opening_cash, business.minimum_reserve);
  return workbookBytes([
    { name: "Summary", rows: [["FinSight AI", business.name], ["Currency", business.currency], ["As of", today()], ["Completed revenue", kpis.revenue], ["Completed expenses", kpis.expenses], ["Net operating cash flow", kpis.netCashFlow], ["Current operating cash", kpis.currentCash], ["Receivables", kpis.accountsReceivable], ["Payables", kpis.accountsPayable], ["Working capital", kpis.workingCapital], ["Basis", "Cash-basis device records; includes pending sync changes, not an audited P&L."]] },
    { name: "Ledger", rows: ledgerRows(snapshot) },
    { name: "Invoices", rows: [["Number", "Direction", "Counterparty", "Due date", "Amount", "Paid", "Outstanding", "Currency"], ...snapshot.invoices.map((invoice) => [invoice.invoice_number, invoice.direction, invoice.counterparty, invoice.due_date, invoice.amount, invoice.amount_paid, invoice.amount_due, invoice.currency])] },
    { name: "Monthly", rows: [["Month", "Revenue", "Expenses", "Net"], ...monthlySummary(snapshot.transactions).map((month) => [month.month, month.revenue, month.expenses, month.net])] },
  ]);
}

export function backupJson(snapshot: Snapshot): string {
  return JSON.stringify({ schema: "finsight.backup.v1", exported_at: new Date().toISOString(), snapshot }, null, 2);
}
