import { MobileStorage } from "./storage";
import { Transaction, Invoice, Account } from "../types";

const DEFAULT_API = "https://finsight-api-public.onrender.com";

export class MobileSyncService {
  private apiUrl: string;
  private token: string | null = null;
  private businessId: number | null = null;
  private isSyncing = false;

  constructor(apiUrl = DEFAULT_API) {
    this.apiUrl = apiUrl;
  }

  public setCredentials(token: string, businessId: number) {
    this.token = token;
    this.businessId = businessId;
  }

  public async sync(): Promise<{ success: boolean; pushed: number; pulled: number; error?: string }> {
    if (this.isSyncing) {
      return { success: false, pushed: 0, pulled: 0, error: "Sync already in progress" };
    }
    if (!this.token || !this.businessId) {
      const auth = await MobileStorage.getAuth();
      if (!auth.token || !auth.business) {
        return { success: false, pushed: 0, pulled: 0, error: "Not authenticated" };
      }
      this.token = auth.token;
      this.businessId = auth.business.id;
    }

    this.isSyncing = true;
    let pushedCount = 0;
    let pulledCount = 0;

    try {
      // 1. Push any queued offline mutations
      const queue = await MobileStorage.getOfflineQueue();
      if (queue.length > 0) {
        const pushRes = await fetch(`${this.apiUrl}/api/sync/push`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.token}`,
            "X-Business-Id": String(this.businessId),
          },
          body: JSON.stringify({ mutations: queue }),
        });

        if (pushRes.ok) {
          const pushData = await pushRes.json();
          for (const applied of pushData.applied ?? []) {
            await MobileStorage.removeOfflineMutation(applied.client_mutation_id);
            pushedCount++;
          }
        }
      }

      // 2. Pull incremental updates from server
      const { latestSeq } = await MobileStorage.getSyncMeta();
      const pullRes = await fetch(`${this.apiUrl}/api/sync/pull`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
          "X-Business-Id": String(this.businessId),
        },
        body: JSON.stringify({ since_seq: latestSeq }),
      });

      if (!pullRes.ok) {
        throw new Error(`Sync pull failed with status ${pullRes.status}`);
      }

      const pullData = await pullRes.json();
      if (pullData.mode === "baseline") {
        // Initial baseline snapshot
        await MobileStorage.saveTransactions(pullData.data.transactions ?? []);
        await MobileStorage.saveAccounts(pullData.data.accounts ?? []);
        await MobileStorage.saveInvoices(pullData.data.invoices ?? []);
        await MobileStorage.updateSyncMeta(pullData.latest_seq);
        pulledCount = (pullData.data.transactions ?? []).length;
      } else if (pullData.mode === "delta") {
        // Incremental updates
        const localTx = await MobileStorage.getTransactions();
        let updatedTx = [...localTx];

        for (const change of pullData.changes ?? []) {
          if (change.entity_type === "transaction") {
            if (change.action === "create") {
              if (!updatedTx.some((t) => t.id === change.entity_id)) {
                updatedTx.unshift(change.data);
              }
            } else if (change.action === "update") {
              updatedTx = updatedTx.map((t) => (t.id === change.entity_id ? { ...t, ...change.data } : t));
            } else if (change.action === "delete") {
              updatedTx = updatedTx.filter((t) => t.id !== change.entity_id);
            }
            pulledCount++;
          }
        }

        await MobileStorage.saveTransactions(updatedTx);
        await MobileStorage.updateSyncMeta(pullData.new_seq);
      }

      return { success: true, pushed: pushedCount, pulled: pulledCount, pushedCount, pulledCount };
    } catch (err: any) {
      return { success: false, pushed: pushedCount, pulled: pulledCount, pushedCount, pulledCount, error: err.message };
    } finally {
      this.isSyncing = false;
    }
  }

  public async getStatus(): Promise<{ lastSync: string | null; lastSeq: number; pendingCount: number }> {
    const meta = await MobileStorage.getSyncMeta();
    const queue = await MobileStorage.getOfflineQueue();
    return {
      lastSync: meta.lastSyncTime || null,
      lastSeq: meta.latestSeq || 0,
      pendingCount: queue.length,
    };
  }

  // Create an offline draft and queue it
  public async createOfflineTransaction(tx: Omit<Transaction, "id">): Promise<Transaction> {
    const tempId = -Math.floor(Date.now() + Math.random() * 1000);
    const draft: Transaction = {
      ...tx,
      id: tempId,
      is_offline_draft: true,
    };

    // Save locally immediately
    const existing = await MobileStorage.getTransactions();
    existing.unshift(draft);
    await MobileStorage.saveTransactions(existing);

    // Queue for sync
    const clientMutationId = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    await MobileStorage.enqueueOfflineMutation({
      client_mutation_id: clientMutationId,
      entity_type: "transaction",
      action: "create",
      data: tx,
      timestamp: new Date().toISOString(),
    });

    return draft;
  }
}

export const syncService = new MobileSyncService();
export const MobileSyncCoordinator = syncService;
