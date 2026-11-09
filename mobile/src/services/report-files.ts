import { File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Snapshot } from "../types";
import { backupJson, financialWorkbook, ledgerCsv, reportHtml } from "./exports";

export async function shareExport(snapshot: Snapshot, mode: string, format: "pdf" | "xlsx" | "csv" | "json"): Promise<void> {
  if (!await Sharing.isAvailableAsync()) throw new Error("File sharing is not available on this device.");
  let uri: string;
  if (format === "pdf") {
    const printed = await Print.printToFileAsync({ html: reportHtml(snapshot, mode), base64: false });
    uri = printed.uri;
  } else {
    const file = new File(Paths.cache, `FinSight-${Date.now()}.${format}`);
    file.create({ overwrite: true });
    file.write(format === "xlsx" ? financialWorkbook(snapshot) : format === "csv" ? ledgerCsv(snapshot) : backupJson(snapshot));
    uri = file.uri;
  }
  const mimeTypes = { pdf: "application/pdf", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv", json: "application/json" };
  await Sharing.shareAsync(uri, { mimeType: mimeTypes[format], dialogTitle: `FinSight ${format.toUpperCase()} export`, UTI: format === "pdf" ? "com.adobe.pdf" : undefined });
}
