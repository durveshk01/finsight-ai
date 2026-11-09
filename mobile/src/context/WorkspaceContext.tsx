import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import * as Crypto from "expo-crypto";
import { AccountInput, Business, InvoiceInput, OfflineMutation, PaymentInput, Session, Snapshot, TransactionInput, WorkspaceData } from "../types";
import { MobileStorage } from "../services/storage";
import { SyncResult, syncService } from "../services/sync";
import { addMutation, materializeWorkspace } from "../services/workspace";
import { errorMessage, toMinor } from "../services/money";
import { requireText, validateInvoice, validatePayment, validateTransaction } from "../services/validation";
import { transactionFingerprint } from "../services/imports";

interface WorkspaceContextValue {
  session: Session | null;
  workspace: WorkspaceData | null;
  snapshot: Snapshot | null;
  loading: boolean;
  startupError: string | null;
  syncing: boolean;
  needsSignIn: boolean;
  canWrite: boolean;
  openSession: (session: Session) => Promise<void>;
  signOut: () => Promise<void>;
  syncNow: () => Promise<SyncResult>;
  saveTransaction: (input: TransactionInput, id?: number) => Promise<void>;
  deleteTransaction: (id: number) => Promise<void>;
  saveInvoice: (input: InvoiceInput, id?: number) => Promise<void>;
  deleteInvoice: (id: number) => Promise<void>;
  recordPayment: (input: PaymentInput) => Promise<void>;
  createAccount: (input: AccountInput) => Promise<void>;
  updateBusiness: (business: Business) => Promise<void>;
  discardQueue: () => Promise<void>;
  importTransactions: (transactions: TransactionInput[]) => Promise<number>;
  restoreBackup: (snapshot: Snapshot) => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const active = useRef<Session | null>(null);
  const flight = useRef<{ id: string; promise: Promise<SyncResult> } | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const saved = await MobileStorage.getSession();
        const data = saved ? await MobileStorage.getWorkspace(saved) : null;
        if (mounted) { active.current = saved; setSession(saved); setWorkspace(data); }
      } catch (error) { if (mounted) setStartupError(errorMessage(error)); }
      finally { if (mounted) setLoading(false); }
    })();
    return () => { mounted = false; };
  }, []);

  const openSession = useCallback(async (next: Session) => {
    const data = await MobileStorage.getWorkspace(next);
    await MobileStorage.saveSession(next);
    active.current = next;
    setSession(next); setWorkspace(data); setStartupError(null); setNeedsSignIn(false); setSyncing(false);
  }, []);

  const signOut = useCallback(async () => {
    active.current = null;
    setSession(null); setWorkspace(null); setNeedsSignIn(false); setSyncing(false); setStartupError(null);
    await MobileStorage.clearSession();
  }, []);

  const syncNow = useCallback(async (): Promise<SyncResult> => {
    const current = active.current;
    if (!current) return { success: false, pushed: 0, pulled: 0, error: "Open a workspace first." };
    if (flight.current?.id === current.workspaceId) return flight.current.promise;
    if (current.mode === "local") return { success: false, pushed: 0, pulled: 0, error: "Local workspace: records are stored on this device only." };
    setSyncing(true);
    const promise = (async () => {
      try {
        const result = await syncService.sync(current, (next) => {
          if (active.current?.workspaceId === current.workspaceId) setWorkspace(next);
        });
        if (active.current?.workspaceId === current.workspaceId) {
          setNeedsSignIn(Boolean(result.needsSignIn));
          if (result.role) {
            const latest = await MobileStorage.getWorkspace(current);
            if (active.current?.workspaceId !== current.workspaceId) return result;
            const next = { ...current, role: result.role, business: latest.snapshot.business };
            await MobileStorage.saveSession(next);
            if (active.current?.workspaceId === current.workspaceId) { active.current = next; setSession(next); }
          }
        }
        return result;
      } catch (error) { return { success: false, pushed: 0, pulled: 0, error: errorMessage(error) }; }
      finally {
        if (active.current?.workspaceId === current.workspaceId) setSyncing(false);
        if (flight.current?.id === current.workspaceId) flight.current = null;
      }
    })();
    flight.current = { id: current.workspaceId, promise };
    return promise;
  }, []);

  useEffect(() => {
    if (!session || session.mode !== "cloud") return;
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) void syncNow();
    });
    const appState = AppState.addEventListener("change", (state) => { if (state === "active") void syncNow(); });
    const timer = setInterval(() => { if (AppState.currentState === "active") void syncNow(); }, 60000);
    return () => { unsubscribe(); appState.remove(); clearInterval(timer); };
  }, [session?.workspaceId, session?.mode, syncNow]);

  const commit = useCallback(async (build: (snapshot: Snapshot, id: number) => Pick<OfflineMutation, "entity_type" | "action" | "data" | "entity_id">) => {
    const current = active.current;
    if (!current || current.role === "viewer") throw new Error("This workspace is read-only. Cloud editors become available after a successful sync.");
    const uuid = Crypto.randomUUID();
    const next = await MobileStorage.updateWorkspace(current, (data) => {
      const mutation = build(materializeWorkspace(data), data.nextId);
      return addMutation(data, { ...mutation, local_id: data.nextId, client_mutation_id: uuid, created_at: new Date().toISOString() }, current.mode === "cloud");
    });
    if (active.current?.workspaceId === current.workspaceId) setWorkspace(next);
  }, []);

  useEffect(() => {
    if (session?.mode === "cloud" && workspace?.queue.length && !workspace.sync.lastError) void syncNow();
  }, [session?.mode, workspace?.queue.length, workspace?.sync.lastError, syncNow]);

  const saveTransaction = useCallback(async (input: TransactionInput, id?: number) => {
    await commit((view) => {
      const previous = id == null ? null : view.transactions.find((row) => row.id === id);
      if (id != null && !previous) throw new Error("Transaction not found.");
      if (previous?.invoice_id) throw new Error("Invoice payments cannot be edited as ordinary ledger entries.");
      return { entity_type: "transaction", action: id == null ? "create" : "update", entity_id: id, data: { ...validateTransaction(input, view) } };
    });
  }, [commit]);

  const deleteTransaction = useCallback(async (id: number) => {
    await commit((view) => {
      const record = view.transactions.find((row) => row.id === id);
      if (!record) throw new Error("Transaction not found.");
      if (record.invoice_id) throw new Error("Invoice payments cannot be deleted as ordinary ledger entries.");
      return { entity_type: "transaction", action: "delete", entity_id: id, data: {} };
    });
  }, [commit]);

  const saveInvoice = useCallback(async (input: InvoiceInput, id?: number) => {
    await commit((view) => {
      const previous = id == null ? null : view.invoices.find((row) => row.id === id);
      if (id != null && !previous) throw new Error("Invoice not found.");
      if (previous && toMinor(input.amount) < toMinor(previous.amount_paid)) throw new Error("Invoice amount cannot be less than payments already recorded.");
      if (previous?.amount_paid && input.direction !== previous.direction) throw new Error("A paid invoice cannot change direction.");
      return { entity_type: "invoice", action: id == null ? "create" : "update", entity_id: id, data: { ...validateInvoice(input, view, id) } };
    });
  }, [commit]);

  const deleteInvoice = useCallback(async (id: number) => {
    await commit((view) => {
      const invoice = view.invoices.find((row) => row.id === id);
      if (!invoice) throw new Error("Invoice not found.");
      if (invoice.amount_paid > 0) throw new Error("An invoice with payments cannot be deleted.");
      return { entity_type: "invoice", action: "delete", entity_id: id, data: {} };
    });
  }, [commit]);

  const recordPayment = useCallback(async (input: PaymentInput) => {
    await commit((view) => ({ entity_type: "payment", action: "create", data: { ...validatePayment(input, view) } }));
  }, [commit]);

  const createAccount = useCallback(async (input: AccountInput) => {
    await commit((view) => {
      const name = requireText(input.name, "Account name", 2, 120);
      if (view.accounts.some((account) => account.name.toLowerCase() === name.toLowerCase())) throw new Error("An account with this name already exists.");
      if (input.currency !== view.business.currency) throw new Error("Account currency must match the workspace.");
      toMinor(input.opening_balance);
      return { entity_type: "account", action: "create", data: { ...input, name } };
    });
  }, [commit]);

  const updateBusiness = useCallback(async (business: Business) => {
    if (active.current?.role !== "owner") throw new Error("Only the workspace owner can update its settings.");
    await commit((view) => {
      const name = requireText(business.name, "Workspace name");
      toMinor(business.opening_cash);
      if (toMinor(business.minimum_reserve) < 0) throw new Error("Minimum reserve cannot be negative.");
      if (business.currency !== view.business.currency && (view.transactions.length || view.invoices.length || view.accounts.length)) throw new Error("Currency cannot change after accounts or financial records have been created.");
      return { entity_type: "business", action: "update", entity_id: business.id, data: { name, currency: business.currency, opening_cash: business.opening_cash, minimum_reserve: business.minimum_reserve } };
    });
  }, [commit]);

  const discardQueue = useCallback(async () => {
    const current = active.current;
    if (!current) return;
    const next = await MobileStorage.updateWorkspace(current, (data) => ({ ...data, queue: [], sync: { ...data.sync, lastError: null } }));
    if (active.current?.workspaceId === current.workspaceId) setWorkspace(next);
  }, []);

  const importTransactions = useCallback(async (transactions: TransactionInput[]) => {
    const current = active.current;
    if (!current || current.role === "viewer") throw new Error("This workspace is read-only.");
    const ids = transactions.map(() => Crypto.randomUUID());
    let imported = 0;
    const next = await MobileStorage.updateWorkspace(current, (data) => {
      let updated = data;
      const seen = new Set(materializeWorkspace(data).transactions.map(transactionFingerprint));
      transactions.forEach((input, index) => {
        const checked = validateTransaction(input, materializeWorkspace(updated));
        const fingerprint = transactionFingerprint(checked);
        if (seen.has(fingerprint)) return;
        seen.add(fingerprint);
        updated = addMutation(updated, { client_mutation_id: ids[index], entity_type: "transaction", action: "create", data: { ...checked }, local_id: updated.nextId, created_at: new Date().toISOString() }, current.mode === "cloud");
        imported++;
      });
      return updated;
    });
    if (active.current?.workspaceId === current.workspaceId) setWorkspace(next);
    return imported;
  }, []);

  const restoreBackup = useCallback(async (restored: Snapshot) => {
    const current = active.current;
    if (!current) throw new Error("Open a workspace first.");
    const nextSession: Session = { ...current, workspaceId: `local.${Crypto.randomUUID()}`, mode: "local", apiUrl: null, token: null, role: "owner", business: { ...restored.business, id: -1 }, user: { id: -1, name: current.user.name, email: "" } };
    const ids = [...restored.transactions, ...restored.invoices, ...restored.accounts].map((record) => record.id);
    await MobileStorage.updateWorkspace(nextSession, (data) => ({ ...data, nextId: Math.min(-1, ...ids) - 1, snapshot: { ...restored, business: nextSession.business } }));
    await openSession(nextSession);
  }, [openSession]);

  const snapshot = useMemo(() => workspace ? materializeWorkspace(workspace) : null, [workspace]);
  const value: WorkspaceContextValue = {
    session, workspace, snapshot, loading, startupError, syncing, needsSignIn,
    canWrite: Boolean(session && session.role !== "viewer"),
    openSession, signOut, syncNow, saveTransaction, deleteTransaction, saveInvoice, deleteInvoice,
    recordPayment, createAccount, updateBusiness, discardQueue, importTransactions, restoreBackup,
  };
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("Workspace provider is missing.");
  return value;
}
