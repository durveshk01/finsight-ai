import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Session, WorkspaceData } from "../types";
import { emptyWorkspace } from "./workspace";

const SESSION_KEY = "finsight.v2.session";
const TOKEN_KEY = "finsight.v2.token";
const LOCAL_SESSION_KEY = "finsight.v2.local-session";
const workspaceKey = (workspaceId: string) => `finsight.v2.workspace.${workspaceId}`;
let writes: Promise<unknown> = Promise.resolve();

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = writes.then(operation, operation);
  writes = result.catch(() => undefined);
  return result;
}

function decodeWorkspace(raw: string, session: Session): WorkspaceData {
  const data = JSON.parse(raw) as WorkspaceData;
  if (data.version !== 1 || data.snapshot?.business?.id !== session.business.id ||
    !Array.isArray(data.snapshot?.transactions) || !Array.isArray(data.snapshot?.accounts) ||
    !Array.isArray(data.snapshot?.invoices) || !Array.isArray(data.queue) ||
    !Number.isSafeInteger(data.nextId) || data.nextId >= 0 || !data.sync || !Number.isSafeInteger(data.sync.latestSeq)) {
    throw new Error("Workspace data could not be read. Your stored records have been retained.");
  }
  return data;
}

export const MobileStorage = {
  saveSession(session: Session): Promise<void> {
    return serialize(async () => {
      const { token, ...metadata } = session;
      if (token) await SecureStore.setItemAsync(TOKEN_KEY, token, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
      else await SecureStore.deleteItemAsync(TOKEN_KEY);
      await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(metadata));
      if (session.mode === "local") await AsyncStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(metadata));
      // Never retain the legacy plaintext bearer token.
      await AsyncStorage.removeItem("finsight_mobile_token");
    });
  },

  async getSession(): Promise<Session | null> {
    await AsyncStorage.removeItem("finsight_mobile_token");
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const metadata = JSON.parse(raw) as Omit<Session, "token">;
    if (!metadata.workspaceId || !metadata.business || !["local", "cloud"].includes(metadata.mode)) {
      throw new Error("Saved session could not be restored. Sign in again.");
    }
    const token = metadata.mode === "cloud" ? await SecureStore.getItemAsync(TOKEN_KEY) : null;
    if (metadata.mode === "cloud" && !token) {
      await AsyncStorage.removeItem(SESSION_KEY);
      return null;
    }
    return { ...metadata, token };
  },

  async getLocalSession(): Promise<Session | null> {
    const raw = await AsyncStorage.getItem(LOCAL_SESSION_KEY);
    if (!raw) return null;
    const metadata = JSON.parse(raw) as Omit<Session, "token">;
    if (metadata.mode !== "local" || !metadata.workspaceId || !metadata.business || !metadata.user) return null;
    return { ...metadata, token: null };
  },

  clearSession(): Promise<void> {
    return serialize(async () => {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      await AsyncStorage.multiRemove([SESSION_KEY, "finsight_mobile_token", "finsight_mobile_user", "finsight_mobile_business"]);
    });
  },

  async getWorkspace(session: Session): Promise<WorkspaceData> {
    await writes;
    const raw = await AsyncStorage.getItem(workspaceKey(session.workspaceId));
    if (!raw) return emptyWorkspace(session);
    return decodeWorkspace(raw, session);
  },

  updateWorkspace(session: Session, update: (workspace: WorkspaceData) => WorkspaceData): Promise<WorkspaceData> {
    // One atomic storage write contains both the ledger snapshot and its mutation queue.
    // Serializing read-modify-write operations prevents rapid taps/sync from losing entries.
    return serialize(async () => {
      const raw = await AsyncStorage.getItem(workspaceKey(session.workspaceId));
      const workspace = raw ? decodeWorkspace(raw, session) : emptyWorkspace(session);
      const next = update(workspace);
      await AsyncStorage.setItem(workspaceKey(session.workspaceId), JSON.stringify(next));
      return next;
    });
  },
};
