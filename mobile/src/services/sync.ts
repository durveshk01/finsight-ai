import { Session, SyncPullResponse, SyncPushResponse, WorkspaceData, WorkspaceRole } from "../types";
import { apiRequest, ApiError } from "./api";
import { errorMessage } from "./money";
import { MobileStorage } from "./storage";
import { acknowledgeMutation, applyPull } from "./workspace";

export interface SyncResult {
  success: boolean;
  pushed: number;
  pulled: number;
  error?: string;
  needsSignIn?: boolean;
  role?: WorkspaceRole;
}

export class MobileSyncService {
  private running = new Set<string>();

  async sync(session: Session, onChange: (data: WorkspaceData) => void = () => undefined): Promise<SyncResult> {
    if (session.mode === "local") return { success: false, pushed: 0, pulled: 0, error: "This is a device-only workspace. Cloud sync requires a cloud account." };
    if (!session.apiUrl || !session.token) return { success: false, pushed: 0, pulled: 0, error: "Sign in to synchronize.", needsSignIn: true };
    if (this.running.has(session.workspaceId)) return { success: false, pushed: 0, pulled: 0, error: "Synchronization is already running." };
    this.running.add(session.workspaceId);
    let pushed = 0;
    let pulled = 0;
    let conflict: string | undefined;
    let role: WorkspaceRole | undefined;
    try {
      // Re-read after each acknowledgement: server IDs replace draft IDs in dependent mutations.
      for (let count = 0; count < 500; count++) {
        const local = await MobileStorage.getWorkspace(session);
        const mutation = local.queue[0];
        if (!mutation) break;
        let response: SyncPushResponse;
        try {
          response = await apiRequest<SyncPushResponse>(session.apiUrl, "/api/sync/push", {
            mutations: [{ client_mutation_id: mutation.client_mutation_id, entity_type: mutation.entity_type,
              action: mutation.action, entity_id: mutation.entity_id, data: mutation.data }],
          }, session);
        } catch (error) {
          // Refresh permissions even when a former editor's queued writes are refused.
          if (!(error instanceof ApiError) || error.status !== 403) throw error;
          role = "viewer";
          conflict = error.message;
          const next = await MobileStorage.updateWorkspace(session, (workspace) => ({
            ...workspace, queue: workspace.queue.map((item) => item.client_mutation_id === mutation.client_mutation_id ? { ...item, error: conflict } : item),
          }));
          onChange(next);
          break;
        }
        const acknowledgement = response.applied?.find((item) => item.client_mutation_id === mutation.client_mutation_id);
        if (!acknowledgement) {
          conflict = response.conflicts?.find((item) => item.client_mutation_id === mutation.client_mutation_id)?.error || "The server did not accept a pending change.";
          const next = await MobileStorage.updateWorkspace(session, (workspace) => ({
            ...workspace, queue: workspace.queue.map((item) => item.client_mutation_id === mutation.client_mutation_id ? { ...item, error: conflict } : item),
          }));
          onChange(next);
          break;
        }
        const next = await MobileStorage.updateWorkspace(session, (workspace) => acknowledgeMutation(workspace, acknowledgement));
        onChange(next);
        pushed++;
      }
      for (let page = 0; page < 100; page++) {
        const local = await MobileStorage.getWorkspace(session);
        const response = await apiRequest<SyncPullResponse>(session.apiUrl, "/api/sync/pull", { since_seq: local.sync.latestSeq, limit: 200 }, session);
        if (response.protocol_version !== 2 || response.business?.id !== session.business.id ||
          !["owner", "admin", "accountant", "viewer"].includes(response.role) ||
          !Number.isSafeInteger(response.latest_seq) || response.latest_seq < 0 ||
          !["baseline", "delta"].includes(response.mode) ||
          (response.mode === "baseline" && (!Array.isArray(response.data?.transactions) || !Array.isArray(response.data?.accounts) || !Array.isArray(response.data?.invoices)))) {
          throw new Error("The API returned an incompatible workspace response. Deploy FinSight API 1.1 or later with sync protocol 2.");
        }
        role = response.role ?? "viewer";
        pulled += response.mode === "baseline" ? response.data?.transactions.length ?? 0 : response.changes?.length ?? 0;
        const next = await MobileStorage.updateWorkspace(session, (workspace) => applyPull(workspace, response));
        onChange(next);
        if (!response.has_more) break;
        if (page === 99) throw new Error("More cloud changes remain. Synchronize again to continue.");
      }
      if (!conflict && (await MobileStorage.getWorkspace(session)).queue.length) conflict = "More local changes remain. Synchronize again to continue.";
      const next = await MobileStorage.updateWorkspace(session, (workspace) => ({
        ...workspace, sync: { ...workspace.sync, lastSyncTime: new Date().toISOString(), lastError: conflict ?? null },
      }));
      onChange(next);
      return { success: !conflict, pushed, pulled, error: conflict, role };
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) role = "viewer";
      const message = errorMessage(error);
      const next = await MobileStorage.updateWorkspace(session, (workspace) => ({ ...workspace, sync: { ...workspace.sync, lastError: message } }));
      onChange(next);
      return { success: false, pushed, pulled, error: message, needsSignIn: error instanceof ApiError && error.status === 401, role };
    } finally { this.running.delete(session.workspaceId); }
  }
}

export const syncService = new MobileSyncService();
