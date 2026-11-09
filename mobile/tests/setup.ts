import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

jest.mock("@react-native-async-storage/async-storage", () => {
  const values = new Map<string, string>();
  return { __esModule: true, default: {
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { values.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { values.delete(key); }),
    multiRemove: jest.fn(async (keys: string[]) => { keys.forEach((key) => values.delete(key)); }),
    getAllKeys: jest.fn(async () => [...values.keys()]),
    clear: jest.fn(async () => { values.clear(); }),
  } };
});

jest.mock("expo-secure-store", () => {
  const values = new Map<string, string>();
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
    setItemAsync: jest.fn(async (key: string, value: string) => { values.set(key, value); }),
    getItemAsync: jest.fn(async (key: string) => values.get(key) ?? null),
    deleteItemAsync: jest.fn(async (key: string) => { values.delete(key); }),
  };
});

jest.mock("expo-crypto", () => {
  let sequence = 0;
  return { randomUUID: jest.fn(() => `device-test-${++sequence}`) };
});

jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => jest.fn()), fetch: jest.fn(async () => ({ isConnected: false })) },
}));

jest.mock("react-native-safe-area-context", () => require("react-native-safe-area-context/jest/mock").default);

jest.mock("expo-file-system", () => {
  const files = new Map<string, string | Uint8Array>();
  class File {
    uri: string;
    constructor(...parts: string[]) { this.uri = parts.join("/"); }
    get size() { const value = files.get(this.uri); return value?.length ?? 0; }
    create() { files.set(this.uri, ""); }
    write(value: string | Uint8Array) { files.set(this.uri, value); }
    async text() { const value = files.get(this.uri); if (typeof value !== "string") throw new Error("Not a text file."); return value; }
  }
  return { File, Paths: { cache: "file:///cache" }, __files: files };
});
jest.mock("expo-print", () => ({ printToFileAsync: jest.fn(async () => ({ uri: "file:///cache/report.pdf" })) }));
jest.mock("expo-sharing", () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => undefined) }));
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn(async () => ({ canceled: true, assets: null })) }));

beforeEach(async () => {
  await AsyncStorage.clear();
  await SecureStore.deleteItemAsync("finsight.v2.token");
  jest.requireMock("expo-file-system").__files.clear();
});
afterEach(() => { jest.restoreAllMocks(); });
