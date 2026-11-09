// User-entered money and ledger totals use integer minor units, never floating-point sums.
export function toMinor(value: string | number): number {
  const text = String(value).trim();
  if (!/^-?\d{1,12}(\.\d{1,2})?$/.test(text)) {
    throw new Error("Enter an amount with at most 12 whole-number digits and 2 decimal places.");
  }
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace(/^-/, "").split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor)) throw new Error("Amount is too large.");
  return negative ? -minor : minor;
}

export function parseAmount(value: string, allowZero = false, allowNegative = false): number {
  const minor = toMinor(value);
  if (!allowNegative && minor < 0) throw new Error("Amount cannot be negative.");
  if (!allowZero && minor === 0) throw new Error("Amount must be greater than zero.");
  return minor / 100;
}

export function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function today(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T12:00:00Z`)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

export function addDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(first: string, last: string): number {
  return Math.round((Date.parse(`${last}T12:00:00Z`) - Date.parse(`${first}T12:00:00Z`)) / 86400000);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred. Please try again.";
}
