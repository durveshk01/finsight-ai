import { strFromU8, unzipSync } from "fflate";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { backupJson, financialWorkbook, ledgerCsv, reportHtml } from "../src/services/exports";
import { parseCsv, previewLedgerCsv, readBackup } from "../src/services/imports";
import { shareExport } from "../src/services/report-files";
import { account, invoice, snapshot, transaction } from "./fixtures";

test("CSV quotes embedded commas/newlines and prevents spreadsheet formulas", () => {
  const csv = ledgerCsv(snapshot({ transactions: [transaction({ description: '=HYPERLINK("bad")', category: "Sales, retail", reference: "line 1\nline 2" })] }));
  expect(csv.startsWith("\uFEFF")).toBe(true);
  const rows = parseCsv(csv);
  expect(rows[1][2]).toBe("Sales, retail");
  expect(rows[1][4]).toBe('\'=HYPERLINK("bad")');
  expect(rows[1][7]).toBe("line 1\nline 2");
  expect(() => parseCsv('date,description\n2025-01-01,"unclosed')).toThrow(/unclosed/);
});

test("imports skip exact duplicates but retain distinct accounts/statuses and report invalid rows", () => {
  const data = snapshot({ accounts: [account(), account({ id: 2, name: "Cash" })], transactions: [transaction({ account_id: 1, payment_method: "Imported" })] });
  const csv = 'date,kind,category,amount,description,account,status\n2025-01-30,income,Sales Revenue,10,Recorded sale,Bank,completed\n2025-01-30,income,Sales Revenue,10,Recorded sale,Cash,completed\n2025-01-30,income,Sales Revenue,10,Recorded sale,Bank,pending\n2025-02-30,income,Sales Revenue,10,Bad date,Bank,completed\n2025-01-30,transfer,Transfer,50,Move,Bank,completed';
  const preview = previewLedgerCsv(csv, data);
  expect(preview.duplicateCount).toBe(1);
  expect(preview.rows).toHaveLength(2);
  expect(preview.rows.map((row) => [row.account_id, row.status])).toEqual([[2, "completed"], [1, "pending"]]);
  expect(preview.errors.map((row) => row.row)).toEqual([5, 6]);
});

test("portable JSON restores actual financial records and rejects corrupt references/currencies/balances", () => {
  const data = snapshot({ accounts: [account()], invoices: [invoice({ account_id: 1 })], transactions: [transaction({ account_id: 1 })] });
  expect(readBackup(backupJson(data))).toEqual(data);
  expect(() => readBackup("not json")).toThrow(/valid JSON/);
  expect(() => readBackup(backupJson({ ...data, transactions: [transaction({ account_id: 99 })] }))).toThrow(/missing account/);
  expect(() => readBackup(backupJson({ ...data, accounts: [account({ currency: "EUR" })] }))).toThrow(/mixed-currency/);
  expect(() => readBackup(backupJson({ ...data, invoices: [invoice({ amount_paid: 101 })] }))).toThrow(/balance/);
  expect(() => readBackup(backupJson({ ...data, transactions: [transaction(), transaction()] }))).toThrow(/duplicate record IDs/);
});

test("Excel bytes are a real four-sheet OOXML archive with numeric cells and no formulas", () => {
  const files = unzipSync(financialWorkbook(snapshot({ transactions: [transaction({ amount: 12.34, description: "=2+2" })] })));
  expect(Object.keys(files)).toContain("[Content_Types].xml");
  expect(Object.keys(files).filter((name) => name.startsWith("xl/worksheets/"))).toHaveLength(4);
  const book = strFromU8(files["xl/workbook.xml"]);
  expect(book).toContain('name="Summary"');
  expect(book).toContain('name="Ledger"');
  const ledger = strFromU8(files["xl/worksheets/sheet2.xml"]);
  expect(ledger).toContain('<c r="D2" t="n"><v>12.34</v></c>');
  expect(ledger).toContain('t="inlineStr"');
  expect(ledger).toContain("=2+2");
  expect(ledger).not.toContain("<f>");
});

test("PDF report escapes user content and states its actual cash basis", () => {
  const html = reportHtml(snapshot({ business: { ...snapshot().business, name: '<script>alert("x")</script>' } }), "local");
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("Opening cash is added once");
  expect(html).toContain("No statement of cloud connectivity");
});

test.each(["pdf", "xlsx", "csv", "json"] as const)("%s export invokes native file generation and sharing with the right MIME type", async (format) => {
  await shareExport(snapshot(), "local", format);
  const [uri, options] = jest.mocked(Sharing.shareAsync).mock.calls[0];
  expect(uri).toMatch(new RegExp(`\\.${format}$`));
  expect(options?.mimeType).toBe({ pdf: "application/pdf", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv", json: "application/json" }[format]);
  if (format === "pdf") expect(Print.printToFileAsync).toHaveBeenCalledWith(expect.objectContaining({ html: expect.stringContaining("Financial summary") }));
  else expect(jest.requireMock("expo-file-system").__files.get(uri)).toBeDefined();
});

test("unavailable sharing returns an actionable error", async () => {
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValueOnce(false);
  await expect(shareExport(snapshot(), "local", "csv")).rejects.toThrow(/not available/);
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});
