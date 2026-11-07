import AsyncStorage from "@react-native-async-storage/async-storage";
import { Transaction, Account, Invoice, OfflineMutation } from "../types";

const KEYS = {
  TOKEN: "finsight_mobile_token",
  USER: "finsight_mobile_user",
  BUSINESS: "finsight_mobile_business",
  TRANSACTIONS: "finsight_mobile_transactions",
  ACCOUNTS: "finsight_mobile_accounts",
  INVOICES: "finsight_mobile_invoices",
  OFFLINE_QUEUE: "finsight_mobile_offline_queue",
  LAST_SYNC_TIME: "finsight_mobile_last_sync_time",
  LATEST_SEQ: "finsight_mobile_latest_seq",
};

export const MobileStorage = {
  async saveAuth(token: string, user: any, business: any) {
    await AsyncStorage.multiSet([
      [KEYS.TOKEN, token],
      [KEYS.USER, JSON.stringify(user)],
      [KEYS.BUSINESS, JSON.stringify(business)],
    ]);
  },

  async getAuth() {
    const results = await AsyncStorage.multiGet([KEYS.TOKEN, KEYS.USER, KEYS.BUSINESS]);
    const token = results[0][1];
    const user = results[1][1] ? JSON.parse(results[1][1]) : null;
    const business = results[2][1] ? JSON.parse(results[2][1]) : null;
    return { token, user, business };
  },

  async clearAuth() {
    await AsyncStorage.multiRemove([KEYS.TOKEN, KEYS.USER, KEYS.BUSINESS]);
  },

  async saveTransactions(transactions: Transaction[]) {
    await AsyncStorage.setItem(KEYS.TRANSACTIONS, JSON.stringify(transactions));
  },

  async getTransactions(): Promise<Transaction[]> {
    const data = await AsyncStorage.getItem(KEYS.TRANSACTIONS);
    return data ? JSON.parse(data) : [];
  },

  async saveAccounts(accounts: Account[]) {
    await AsyncStorage.setItem(KEYS.ACCOUNTS, JSON.stringify(accounts));
  },

  async getAccounts(): Promise<Account[]> {
    const data = await AsyncStorage.getItem(KEYS.ACCOUNTS);
    return data ? JSON.parse(data) : [];
  },

  async saveInvoices(invoices: Invoice[]) {
    await AsyncStorage.setItem(KEYS.INVOICES, JSON.stringify(invoices));
  },

  async getInvoices(): Promise<Invoice[]> {
    const data = await AsyncStorage.getItem(KEYS.INVOICES);
    return data ? JSON.parse(data) : [];
  },

  async getOfflineQueue(): Promise<OfflineMutation[]> {
    const data = await AsyncStorage.getItem(KEYS.OFFLINE_QUEUE);
    return data ? JSON.parse(data) : [];
  },

  async enqueueOfflineMutation(mutation: OfflineMutation) {
    const queue = await this.getOfflineQueue();
    queue.push(mutation);
    await AsyncStorage.setItem(KEYS.OFFLINE_QUEUE, JSON.stringify(queue));
  },

  async removeOfflineMutation(clientMutationId: string) {
    const queue = await this.getOfflineQueue();
    const updated = queue.filter((m) => m.client_mutation_id !== clientMutationId);
    await AsyncStorage.setItem(KEYS.OFFLINE_QUEUE, JSON.stringify(updated));
  },

  async clearOfflineQueue() {
    await AsyncStorage.removeItem(KEYS.OFFLINE_QUEUE);
  },

  async setOfflineQueue(queue: OfflineMutation[]) {
    await AsyncStorage.setItem(KEYS.OFFLINE_QUEUE, JSON.stringify(queue));
  },

  async getSyncMeta() {
    const res = await AsyncStorage.multiGet([KEYS.LAST_SYNC_TIME, KEYS.LATEST_SEQ]);
    return {
      lastSyncTime: res[0][1],
      latestSeq: res[1][1] ? Number(res[1][1]) : 0,
    };
  },

  async updateSyncMeta(seq: number) {
    await AsyncStorage.multiSet([
      [KEYS.LAST_SYNC_TIME, new Date().toISOString()],
      [KEYS.LATEST_SEQ, String(seq)],
    ]);
  },
};
