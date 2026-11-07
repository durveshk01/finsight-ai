"use client";

import React, { useState, useEffect } from "react";
import {
  AlertCircle, ArrowDownRight, ArrowUpRight, Check, CheckCircle2,
  Clock, DollarSign, Download, Eye, FileText, Filter,
  History, Layers, Plus, Printer, Search, ShieldAlert, X
} from "lucide-react";
import { Button, CardTitle, Field, inputClass } from "@/components/ui";

export interface InvoiceItem {
  id: number;
  direction: "receivable" | "payable";
  invoice_number: string;
  counterparty: string;
  issue_date: string;
  due_date: string;
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  category: string;
  account_id: number | null;
  status: "open" | "paid" | "partially_paid" | "overdue";
  description: string;
  created_at?: string | null;
}

export interface AgeingData {
  total_outstanding: number;
  total_overdue: number;
  buckets: {
    current: number;
    days_1_30: number;
    days_31_60: number;
    days_61_90: number;
    days_90_plus: number;
  };
  customers?: { customer: string; total_invoiced: number; total_paid: number; amount_due: number; overdue_amount: number; invoice_count: number }[];
  suppliers?: { supplier: string; total_billed: number; total_paid: number; amount_due: number; overdue_amount: number; bill_count: number }[];
}

export interface AccountOption {
  id: number;
  name: string;
  currency: string;
  is_active: boolean;
}

interface InvoicesManagerProps {
  code: string;
  api: (path: string, init?: RequestInit) => Promise<any>;
  accounts: AccountOption[];
  onRefreshSummary: () => void;
}

export function InvoicesManager({ code, api, accounts, onRefreshSummary }: InvoicesManagerProps) {
  const [activeTab, setActiveTab] = useState<"receivables" | "payables" | "all">("receivables");
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // Ageing reports
  const [arAgeing, setArAgeing] = useState<AgeingData | null>(null);
  const [apAgeing, setApAgeing] = useState<AgeingData | null>(null);

  // New Invoice Modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newDirection, setNewDirection] = useState<"receivable" | "payable">("receivable");
  const [newForm, setNewForm] = useState({
    invoice_number: "",
    counterparty: "",
    amount: "",
    issue_date: new Date().toISOString().slice(0, 10),
    due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    category: "Sales Revenue",
    account_id: "",
    description: "",
  });

  // Payment Modal
  const [paymentModalInvoice, setPaymentModalInvoice] = useState<InvoiceItem | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentAccount, setPaymentAccount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Bank transfer");
  const [paymentRef, setPaymentRef] = useState("");
  const [paymentHistory, setPaymentHistory] = useState<any[]>([]);

  // Printable Invoice Modal
  const [printInvoice, setPrintInvoice] = useState<InvoiceItem | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      const [invRes, arRes, apRes] = await Promise.all([
        api("/api/invoices?limit=100"),
        api("/api/invoices/receivables/ageing"),
        api("/api/invoices/payables/ageing"),
      ]);
      setInvoices(invRes?.items ?? (Array.isArray(invRes) ? invRes : []));
      setArAgeing(arRes && !Array.isArray(arRes) && arRes.buckets ? arRes : null);
      setApAgeing(apRes && !Array.isArray(apRes) && apRes.buckets ? apRes : null);
    } catch (err: any) {
      setError(err.message || "Failed to load invoices");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccessMsg("");
    try {
      await api("/api/invoices", {
        method: "POST",
        body: JSON.stringify({
          ...newForm,
          direction: newDirection,
          amount: Number(newForm.amount),
          account_id: newForm.account_id ? Number(newForm.account_id) : null,
        }),
      });
      setSuccessMsg("Invoice created successfully.");
      setCreateModalOpen(false);
      setNewForm({
        invoice_number: "",
        counterparty: "",
        amount: "",
        issue_date: new Date().toISOString().slice(0, 10),
        due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        category: newDirection === "receivable" ? "Sales Revenue" : "Rent",
        account_id: "",
        description: "",
      });
      await loadData();
      onRefreshSummary();
    } catch (err: any) {
      setError(err.message || "Failed to create invoice");
    }
  };

  const handleOpenPayment = async (inv: InvoiceItem) => {
    setPaymentModalInvoice(inv);
    setPaymentAmount(inv.amount_due.toFixed(2));
    setPaymentAccount(inv.account_id ? String(inv.account_id) : "");
    setPaymentRef(`PAY-${inv.invoice_number}`);
    try {
      const history = await api(`/api/invoices/${inv.id}/payments`);
      setPaymentHistory(history ?? []);
    } catch {
      setPaymentHistory([]);
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentModalInvoice) return;
    setError("");
    try {
      await api(`/api/invoices/${paymentModalInvoice.id}/payments`, {
        method: "POST",
        body: JSON.stringify({
          amount: Number(paymentAmount),
          paid_on: new Date().toISOString().slice(0, 10),
          payment_method: paymentMethod,
          account_id: paymentAccount ? Number(paymentAccount) : null,
          reference: paymentRef,
        }),
      });
      setSuccessMsg(`Payment of ${paymentAmount} recorded.`);
      setPaymentModalInvoice(null);
      await loadData();
      onRefreshSummary();
    } catch (err: any) {
      setError(err.message || "Failed to record payment");
    }
  };

  const currencyFmt = (val: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(val || 0);
  };

  // Filter list
  const filteredInvoices = invoices.filter((item) => {
    if (activeTab === "receivables" && item.direction !== "receivable") return false;
    if (activeTab === "payables" && item.direction !== "payable") return false;
    if (statusFilter && item.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        item.invoice_number.toLowerCase().includes(q) ||
        item.counterparty.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const activeAgeing = activeTab === "receivables" ? arAgeing : apAgeing;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[var(--foreground)]">Accounts Receivable & Accounts Payable</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Manage customer receivables, supplier bills, ageing schedules, and payment settlements.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => {
              setNewDirection("receivable");
              setNewForm((prev) => ({ ...prev, category: "Sales Revenue" }));
              setCreateModalOpen(true);
            }}
          >
            <Plus size={14} /> New Customer Invoice
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setNewDirection("payable");
              setNewForm((prev) => ({ ...prev, category: "Rent" }));
              setCreateModalOpen(true);
            }}
          >
            <Plus size={14} /> New Supplier Bill
          </Button>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/40 dark:border-red-800 dark:text-red-300">
          <AlertCircle size={15} className="shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError("")} className="ml-auto text-xs">&times;</button>
        </div>
      )}
      {successMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-300">
          <CheckCircle2 size={15} className="shrink-0" />
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg("")} className="ml-auto text-xs">&times;</button>
        </div>
      )}

      {/* Tab Switcher */}
      <div className="flex gap-2 border-b border-[var(--line)] pb-3">
        <button
          onClick={() => setActiveTab("receivables")}
          className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${
            activeTab === "receivables"
              ? "bg-[#147354] text-white shadow-sm"
              : "border border-[var(--line)] text-[var(--muted)] hover:bg-[var(--background)]"
          }`}
        >
          Accounts Receivable (Customers)
        </button>
        <button
          onClick={() => setActiveTab("payables")}
          className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${
            activeTab === "payables"
              ? "bg-[#147354] text-white shadow-sm"
              : "border border-[var(--line)] text-[var(--muted)] hover:bg-[var(--background)]"
          }`}
        >
          Accounts Payable (Suppliers)
        </button>
        <button
          onClick={() => setActiveTab("all")}
          className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${
            activeTab === "all"
              ? "bg-[#147354] text-white shadow-sm"
              : "border border-[var(--line)] text-[var(--muted)] hover:bg-[var(--background)]"
          }`}
        >
          All Invoices & Bills
        </button>
      </div>

      {/* Ageing Report Widget (shown on receivables or payables tab) */}
      {activeTab !== "all" && activeAgeing && activeAgeing.buckets && (
        <div className="card soft-shadow p-5 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--foreground)]">
                {activeTab === "receivables" ? "Accounts Receivable Ageing Schedule" : "Accounts Payable Ageing Schedule"}
              </h3>
              <p className="text-xs text-[var(--muted)]">Classification of outstanding balances by days past due</p>
            </div>
            <div className="text-right text-xs">
              <span className="text-[var(--muted)]">Total Outstanding: </span>
              <span className="font-bold text-[var(--foreground)]">{currencyFmt(activeAgeing.total_outstanding)}</span>
              {activeAgeing.total_overdue > 0 && (
                <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-700 dark:bg-red-950/60 dark:text-red-400">
                  {currencyFmt(activeAgeing.total_overdue)} Overdue
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-xl border border-[var(--line)] bg-[var(--background)] p-3 text-center">
              <span className="text-[10px] font-medium text-[var(--muted)]">Current (Not Due)</span>
              <div className="mt-1 text-sm font-bold text-emerald-600 dark:text-emerald-400">
                {currencyFmt(activeAgeing.buckets.current)}
              </div>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-[var(--background)] p-3 text-center">
              <span className="text-[10px] font-medium text-[var(--muted)]">1 – 30 Days</span>
              <div className="mt-1 text-sm font-bold text-amber-600 dark:text-amber-400">
                {currencyFmt(activeAgeing.buckets.days_1_30)}
              </div>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-[var(--background)] p-3 text-center">
              <span className="text-[10px] font-medium text-[var(--muted)]">31 – 60 Days</span>
              <div className="mt-1 text-sm font-bold text-orange-600 dark:text-orange-400">
                {currencyFmt(activeAgeing.buckets.days_31_60)}
              </div>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-[var(--background)] p-3 text-center">
              <span className="text-[10px] font-medium text-[var(--muted)]">61 – 90 Days</span>
              <div className="mt-1 text-sm font-bold text-red-500">
                {currencyFmt(activeAgeing.buckets.days_61_90)}
              </div>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-[var(--background)] p-3 text-center">
              <span className="text-[10px] font-medium text-[var(--muted)]">&gt; 90 Days</span>
              <div className="mt-1 text-sm font-bold text-red-700 dark:text-red-400">
                {currencyFmt(activeAgeing.buckets.days_90_plus)}
              </div>
            </div>
          </div>

          {/* Counterparty summary breakdown */}
          <div className="mt-5 border-t border-[var(--line)] pt-4">
            <h4 className="text-xs font-semibold text-[var(--foreground)]">
              {activeTab === "receivables" ? "Customer Outstanding Summary" : "Supplier Obligation Summary"}
            </h4>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[550px] text-left text-xs">
                <thead>
                  <tr className="border-b border-[var(--line)] text-[10px] uppercase text-[var(--muted)]">
                    <th className="pb-2">Counterparty</th>
                    <th className="pb-2">Total Invoiced</th>
                    <th className="pb-2">Total Settled</th>
                    <th className="pb-2">Outstanding Due</th>
                    <th className="pb-2">Overdue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {((activeTab === "receivables" ? activeAgeing.customers : activeAgeing.suppliers) ?? []).map((cp: any, idx: number) => (
                    <tr key={idx} className="hover:bg-[var(--background)]/60">
                      <td className="py-2.5 font-semibold text-[var(--foreground)]">{cp.customer || cp.supplier}</td>
                      <td className="py-2.5">{currencyFmt(cp.total_invoiced || cp.total_billed)}</td>
                      <td className="py-2.5 text-emerald-600">{currencyFmt(cp.total_paid)}</td>
                      <td className="py-2.5 font-bold text-[var(--foreground)]">{currencyFmt(cp.amount_due)}</td>
                      <td className="py-2.5">
                        {cp.overdue_amount > 0 ? (
                          <span className="font-semibold text-red-600">{currencyFmt(cp.overdue_amount)}</span>
                        ) : (
                          <span className="text-[var(--muted)]">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Invoices List Section */}
      <div className="card soft-shadow p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              type="text"
              placeholder="Search by invoice number, customer, supplier..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`${inputClass} pl-9`}
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={`${inputClass} w-auto min-w-[130px]`}
          >
            <option value="">All Statuses</option>
            <option value="open">Open</option>
            <option value="partially_paid">Partially Paid</option>
            <option value="paid">Paid</option>
            <option value="overdue">Overdue</option>
          </select>
        </div>

        {/* Invoices Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[750px] text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--line)] bg-[var(--background)] text-[10px] uppercase tracking-wider text-[var(--muted)]">
                <th className="p-3">Invoice #</th>
                <th className="p-3">Type</th>
                <th className="p-3">Counterparty</th>
                <th className="p-3">Due Date</th>
                <th className="p-3">Total Amount</th>
                <th className="p-3">Outstanding</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-xs text-[var(--muted)]">
                    No matching invoices or bills found.
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-[var(--background)]/60 transition">
                    <td className="p-3 font-semibold text-[var(--foreground)]">{inv.invoice_number}</td>
                    <td className="p-3">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                        inv.direction === "receivable" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300" : "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
                      }`}>
                        {inv.direction}
                      </span>
                    </td>
                    <td className="p-3 text-[var(--foreground)]">{inv.counterparty}</td>
                    <td className="p-3 text-[var(--muted)]">{inv.due_date}</td>
                    <td className="p-3 font-medium">{currencyFmt(inv.amount)}</td>
                    <td className="p-3 font-bold text-[var(--foreground)]">{currencyFmt(inv.amount_due)}</td>
                    <td className="p-3">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${
                        inv.status === "paid"
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                          : inv.status === "overdue"
                          ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
                          : inv.status === "partially_paid"
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                          : "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                      }`}>
                        {inv.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setPrintInvoice(inv)}
                          title="Print / View Invoice"
                          className="rounded p-1.5 text-[var(--muted)] hover:bg-[var(--line)] hover:text-[var(--foreground)]"
                        >
                          <Printer size={13} />
                        </button>
                        {inv.amount_due > 0 && (
                          <Button
                            variant="secondary"
                            className="px-2.5 py-1 text-[11px]"
                            onClick={() => void handleOpenPayment(inv)}
                          >
                            <DollarSign size={12} /> Record Payment
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Invoice / Bill Modal */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between border-b border-[var(--line)] pb-3">
              <h3 className="text-base font-bold text-[var(--foreground)]">
                {newDirection === "receivable" ? "New Customer Receivable Invoice" : "New Supplier Payable Bill"}
              </h3>
              <button onClick={() => setCreateModalOpen(false)} className="text-[var(--muted)] hover:text-[var(--foreground)]">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateInvoice} className="grid gap-3.5 sm:grid-cols-2 text-xs">
              <Field label="Invoice / Reference #">
                <input
                  required
                  placeholder="e.g. INV-2026-001"
                  value={newForm.invoice_number}
                  onChange={(e) => setNewForm({ ...newForm, invoice_number: e.target.value })}
                  className={inputClass}
                />
              </Field>

              <Field label={newDirection === "receivable" ? "Customer Name" : "Supplier / Payee Name"}>
                <input
                  required
                  placeholder="Company or client name"
                  value={newForm.counterparty}
                  onChange={(e) => setNewForm({ ...newForm, counterparty: e.target.value })}
                  className={inputClass}
                />
              </Field>

              <Field label="Total Amount">
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  placeholder="0.00"
                  value={newForm.amount}
                  onChange={(e) => setNewForm({ ...newForm, amount: e.target.value })}
                  className={inputClass}
                />
              </Field>

              <Field label="Issue Date">
                <input
                  type="date"
                  required
                  value={newForm.issue_date}
                  onChange={(e) => setNewForm({ ...newForm, issue_date: e.target.value })}
                  className={inputClass}
                />
              </Field>

              <Field label="Due Date">
                <input
                  type="date"
                  required
                  value={newForm.due_date}
                  onChange={(e) => setNewForm({ ...newForm, due_date: e.target.value })}
                  className={inputClass}
                />
              </Field>

              <Field label="Category">
                <input
                  required
                  value={newForm.category}
                  onChange={(e) => setNewForm({ ...newForm, category: e.target.value })}
                  className={inputClass}
                />
              </Field>

              <Field label="Associated Account" className="sm:col-span-2">
                <select
                  value={newForm.account_id}
                  onChange={(e) => setNewForm({ ...newForm, account_id: e.target.value })}
                  className={inputClass}
                >
                  <option value="">Unassigned</option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({acc.currency})
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Description / Notes" className="sm:col-span-2">
                <input
                  placeholder="Optional details or terms"
                  value={newForm.description}
                  onChange={(e) => setNewForm({ ...newForm, description: e.target.value })}
                  className={inputClass}
                />
              </Field>

              <div className="mt-4 flex justify-end gap-2 sm:col-span-2 border-t border-[var(--line)] pt-3">
                <Button type="button" variant="secondary" onClick={() => setCreateModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">Save Record</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Payment Modal */}
      {paymentModalInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-2xl text-xs">
            <div className="mb-4 flex items-center justify-between border-b border-[var(--line)] pb-3">
              <div>
                <h3 className="text-base font-bold text-[var(--foreground)]">Record Settlement Payment</h3>
                <p className="text-[11px] text-[var(--muted)]">
                  Invoice {paymentModalInvoice.invoice_number} · Outstanding {currencyFmt(paymentModalInvoice.amount_due)}
                </p>
              </div>
              <button onClick={() => setPaymentModalInvoice(null)} className="text-[var(--muted)] hover:text-[var(--foreground)]">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleRecordPayment} className="space-y-3.5">
              <Field label="Payment Amount">
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={paymentModalInvoice.amount_due}
                  required
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className={inputClass}
                />
              </Field>

              <Field label="Deposited Into / Paid From Account">
                <select
                  value={paymentAccount}
                  onChange={(e) => setPaymentAccount(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Choose an account...</option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({acc.currency})
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Payment Method">
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className={inputClass}
                >
                  <option value="Bank transfer">Bank transfer</option>
                  <option value="UPI">UPI</option>
                  <option value="Credit Card">Credit Card</option>
                  <option value="Debit Card">Debit Card</option>
                  <option value="Cheque">Cheque</option>
                  <option value="Cash">Cash</option>
                </select>
              </Field>

              <Field label="Reference / Transaction ID">
                <input
                  value={paymentRef}
                  onChange={(e) => setPaymentRef(e.target.value)}
                  className={inputClass}
                />
              </Field>

              {paymentHistory.length > 0 && (
                <div className="border-t border-[var(--line)] pt-2">
                  <span className="font-semibold text-[var(--foreground)]">Prior Payments:</span>
                  <div className="mt-1 space-y-1">
                    {paymentHistory.map((p, i) => (
                      <div key={i} className="flex justify-between text-[11px] text-[var(--muted)]">
                        <span>{p.paid_on} ({p.payment_method})</span>
                        <span className="font-semibold text-emerald-600">+{currencyFmt(p.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-4 flex justify-end gap-2 border-t border-[var(--line)] pt-3">
                <Button type="button" variant="secondary" onClick={() => setPaymentModalInvoice(null)}>
                  Cancel
                </Button>
                <Button type="submit">Post Payment</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Printable Invoice Modal */}
      {printInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between border-b border-[var(--line)] pb-3">
              <div className="flex items-center gap-2">
                <Printer size={16} className="text-[#147354]" />
                <span className="text-sm font-bold text-[var(--foreground)]">Printable Invoice Document</span>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={() => window.print()} className="px-3 py-1.5 text-xs">
                  <Printer size={13} /> Print
                </Button>
                <button onClick={() => setPrintInvoice(null)} className="text-[var(--muted)] hover:text-[var(--foreground)]">
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--line)] bg-white p-8 text-black dark:bg-[#161b22] dark:text-white">
              <div className="flex justify-between border-b border-[#eee] pb-6 dark:border-[#30363d]">
                <div>
                  <h1 className="text-2xl font-extrabold text-[#147354]">INVOICE</h1>
                  <p className="mt-1 text-xs text-gray-500">#{printInvoice.invoice_number}</p>
                </div>
                <div className="text-right text-xs">
                  <p className="font-bold">FinSight AI Workspace</p>
                  <p className="text-gray-500">Corporate Financial Services</p>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="font-bold text-gray-500">BILLED TO:</p>
                  <p className="mt-1 font-semibold text-base">{printInvoice.counterparty}</p>
                </div>
                <div className="text-right">
                  <p><span className="text-gray-500">Issue Date: </span>{printInvoice.issue_date}</p>
                  <p><span className="text-gray-500">Due Date: </span><span className="font-bold text-red-600">{printInvoice.due_date}</span></p>
                  <p><span className="text-gray-500">Status: </span><span className="font-bold uppercase">{printInvoice.status}</span></p>
                </div>
              </div>

              <div className="mt-8">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b-2 border-gray-200 pb-2 text-[10px] uppercase text-gray-500 dark:border-[#30363d]">
                      <th className="py-2">Description</th>
                      <th className="py-2">Category</th>
                      <th className="py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-gray-100 dark:border-[#30363d]">
                      <td className="py-3">{printInvoice.description || "Professional Services / Merchandise"}</td>
                      <td className="py-3">{printInvoice.category}</td>
                      <td className="py-3 text-right font-bold">{currencyFmt(printInvoice.amount)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="mt-6 flex justify-end text-xs">
                <div className="w-64 space-y-2 border-t border-gray-200 pt-3 dark:border-[#30363d]">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Total Billed:</span>
                    <span className="font-bold">{currencyFmt(printInvoice.amount)}</span>
                  </div>
                  <div className="flex justify-between text-emerald-600">
                    <span>Paid to Date:</span>
                    <span>-{currencyFmt(printInvoice.amount_paid)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-extrabold border-t border-gray-200 pt-2 dark:border-[#30363d]">
                    <span>Balance Due:</span>
                    <span className="text-red-600">{currencyFmt(printInvoice.amount_due)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
