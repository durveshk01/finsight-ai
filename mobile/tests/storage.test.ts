import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { MobileStorage } from "../src/services/storage";
import { addMutation } from "../src/services/workspace";
import { mutation, session } from "./fixtures";

test("rapid concurrent writes do not lose entries or reuse draft IDs", async () => {
  const current = session(true);
  await Promise.all(Array.from({ length: 40 }, () => MobileStorage.updateWorkspace(current, (data) => addMutation(data, mutation(data.nextId), true))));
  const saved = await MobileStorage.getWorkspace(current);
  expect(saved.queue).toHaveLength(40);
  expect(new Set(saved.queue.map((row) => row.local_id)).size).toBe(40);
  expect(saved.nextId).toBe(-41);
});

test("rejected updates remain atomic and do not block subsequent storage writes", async () => {
  const current = session();
  await expect(MobileStorage.updateWorkspace(current, () => { throw new Error("invalid entry"); })).rejects.toThrow("invalid entry");
  await MobileStorage.updateWorkspace(current, (data) => addMutation(data, mutation(-1), false));
  expect((await MobileStorage.getWorkspace(current)).snapshot.transactions).toHaveLength(1);
});

test("bearer tokens stay in SecureStore and sign-out retains financial records", async () => {
  const current = session(true);
  await MobileStorage.updateWorkspace(current, (data) => addMutation(data, mutation(-1), true));
  await MobileStorage.saveSession(current);
  const raw = await AsyncStorage.getItem("finsight.v2.session");
  expect(raw).not.toContain("private-token");
  expect(JSON.parse(raw!).token).toBeUndefined();
  expect(await SecureStore.getItemAsync("finsight.v2.token")).toBe("private-token");
  expect(await MobileStorage.getSession()).toEqual(current);
  await MobileStorage.clearSession();
  expect(await MobileStorage.getSession()).toBeNull();
  expect(await SecureStore.getItemAsync("finsight.v2.token")).toBeNull();
  expect((await MobileStorage.getWorkspace(current)).queue).toHaveLength(1);
});

test("a queued session save cannot resurrect credentials after sign-out", async () => {
  const save = MobileStorage.saveSession(session(true));
  const clear = MobileStorage.clearSession();
  await Promise.all([save, clear]);
  expect(await MobileStorage.getSession()).toBeNull();
  expect(await SecureStore.getItemAsync("finsight.v2.token")).toBeNull();
});

test("local resume survives closing while another tenant sees none of its data", async () => {
  const local = session();
  await MobileStorage.saveSession(local);
  await MobileStorage.updateWorkspace(local, (data) => addMutation(data, mutation(-1), false));
  await MobileStorage.clearSession();
  expect(await MobileStorage.getLocalSession()).toEqual(local);
  expect((await MobileStorage.getWorkspace(local)).snapshot.transactions).toHaveLength(1);
  expect((await MobileStorage.getWorkspace(session(true))).snapshot.transactions).toHaveLength(0);
  expect((await MobileStorage.getWorkspace(session(true, { workspaceId: "cloud.other.8.99" }))).queue).toHaveLength(0);
});

test("legacy plaintext tokens are removed on startup and missing secure credentials require sign-in", async () => {
  await MobileStorage.saveSession(session(true));
  await AsyncStorage.setItem("finsight_mobile_token", "old-plaintext-token");
  await SecureStore.deleteItemAsync("finsight.v2.token");
  expect(await MobileStorage.getSession()).toBeNull();
  expect(await AsyncStorage.getItem("finsight_mobile_token")).toBeNull();
});

test("malformed cached workspaces are retained and rejected instead of crashing the screen", async () => {
  const current = session();
  const raw = JSON.stringify({ version: 1, snapshot: { business: current.business }, queue: [], nextId: -1, sync: { latestSeq: 0 } });
  await AsyncStorage.setItem(`finsight.v2.workspace.${current.workspaceId}`, raw);
  await expect(MobileStorage.getWorkspace(current)).rejects.toThrow(/retained/);
  await expect(MobileStorage.updateWorkspace(current, (data) => data)).rejects.toThrow(/retained/);
  expect(await AsyncStorage.getItem(`finsight.v2.workspace.${current.workspaceId}`)).toBe(raw);
});
