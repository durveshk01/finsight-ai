import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, Modal, Alert, SafeAreaView, StatusBar
} from "react-native";
import {
  Search, Plus, Filter, ArrowUpRight, ArrowDownRight,
  RefreshCw, X, Check, ArrowRightLeft
} from "lucide-react-native";
import { MobileStorage } from "../services/storage";
import { syncService } from "../services/sync";
import { formatCurrency } from "../services/financial-engine";
import { Transaction, TransactionKind } from "../types";

export function TransactionsScreen() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [search, setSearch] = useState("");
  const [filterKind, setFilterKind] = useState<"all" | TransactionKind>("all");
  const [currency, setCurrency] = useState("USD");

  // Modal State
  const [modalVisible, setModalVisible] = useState(false);
  const [kind, setKind] = useState<TransactionKind>("income");
  const [category, setCategory] = useState("Sales Revenue");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");

  const loadTransactions = async () => {
    const auth = await MobileStorage.getAuth();
    if (auth.business?.currency) setCurrency(auth.business.currency);
    const txs = await MobileStorage.getTransactions();
    setTransactions(txs);
  };

  useEffect(() => {
    loadTransactions();
  }, []);

  const handleSaveTransaction = async () => {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      Alert.alert("Invalid Input", "Please enter a valid numeric amount greater than zero.");
      return;
    }

    try {
      await syncService.createOfflineTransaction({
        kind,
        category,
        amount: Number(amount),
        date: new Date().toISOString().slice(0, 10),
        description: description.trim() || `${category}`,
        payment_method: "Mobile App",
        status: "completed",
      });

      setModalVisible(false);
      setAmount("");
      setDescription("");
      await loadTransactions();
      Alert.alert("Saved Locally", "Transaction draft saved to local storage. It will synchronize automatically.");
    } catch (err: any) {
      Alert.alert("Error", err.message || "Could not save transaction");
    }
  };

  const filtered = transactions.filter((t) => {
    if (filterKind !== "all" && t.kind !== filterKind) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        t.description.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0d1117" />
      <View style={styles.header}>
        <Text style={styles.title}>Transactions Ledger</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => setModalVisible(true)}>
          <Plus size={16} color="#ffffff" />
          <Text style={styles.addBtnText}>Add</Text>
        </TouchableOpacity>
      </View>

      {/* Search Input */}
      <View style={styles.searchRow}>
        <View style={styles.searchContainer}>
          <Search size={16} color="#8b949e" style={{ marginRight: 8 }} />
          <TextInput
            placeholder="Search transactions..."
            placeholderTextColor="#8b949e"
            value={search}
            onChangeText={setSearch}
            style={styles.searchInput}
          />
        </View>
      </View>

      {/* Filter Tabs */}
      <View style={styles.filterTabs}>
        {(["all", "income", "expense", "transfer"] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            onPress={() => setFilterKind(tab)}
            style={[styles.tabBtn, filterKind === tab && styles.tabBtnActive]}
          >
            <Text style={[styles.tabBtnText, filterKind === tab && styles.tabBtnTextActive]}>
              {tab.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Transactions List */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.txCard}>
            <View style={styles.txIconBox}>
              {item.kind === "income" ? (
                <ArrowUpRight size={16} color="#3fb950" />
              ) : item.kind === "expense" ? (
                <ArrowDownRight size={16} color="#f85149" />
              ) : (
                <ArrowRightLeft size={16} color="#58a6ff" />
              )}
            </View>
            <View style={styles.txInfo}>
              <Text style={styles.txDesc} numberOfLines={1}>
                {item.description || item.category}
              </Text>
              <Text style={styles.txSub}>
                {item.date} · {item.category} {item.is_offline_draft ? "· (Draft)" : ""}
              </Text>
            </View>
            <Text style={[styles.txAmount, item.kind === "income" ? styles.income : styles.expense]}>
              {item.kind === "income" ? "+" : item.kind === "expense" ? "−" : "⇄"}
              {formatCurrency(item.amount, currency)}
            </Text>
          </View>
        )}
      />

      {/* Add Transaction Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Quick Transaction Entry</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <X size={20} color="#8b949e" />
              </TouchableOpacity>
            </View>

            {/* Kind Selector */}
            <View style={styles.kindSelector}>
              {(["income", "expense", "transfer"] as const).map((k) => (
                <TouchableOpacity
                  key={k}
                  onPress={() => {
                    setKind(k);
                    setCategory(k === "income" ? "Sales Revenue" : k === "expense" ? "Rent" : "Transfer");
                  }}
                  style={[styles.kindBtn, kind === k && styles.kindBtnActive]}
                >
                  <Text style={[styles.kindBtnText, kind === k && styles.kindBtnTextActive]}>
                    {k.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Amount ({currency})</Text>
            <TextInput
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor="#8b949e"
              value={amount}
              onChangeText={setAmount}
              style={styles.modalInput}
            />

            <Text style={styles.fieldLabel}>Category</Text>
            <TextInput
              placeholder="Category name"
              placeholderTextColor="#8b949e"
              value={category}
              onChangeText={setCategory}
              style={styles.modalInput}
            />

            <Text style={styles.fieldLabel}>Description</Text>
            <TextInput
              placeholder="Customer / Supplier / Notes"
              placeholderTextColor="#8b949e"
              value={description}
              onChangeText={setDescription}
              style={styles.modalInput}
            />

            <TouchableOpacity style={styles.saveBtn} onPress={handleSaveTransaction}>
              <Check size={16} color="#ffffff" style={{ marginRight: 6 }} />
              <Text style={styles.saveBtnText}>Save Transaction (Offline Ready)</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0d1117",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: "#ffffff",
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#238636",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#ffffff",
  },
  searchRow: {
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#161b22",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#30363d",
    paddingHorizontal: 12,
    height: 40,
  },
  searchInput: {
    flex: 1,
    color: "#ffffff",
    fontSize: 13,
  },
  filterTabs: {
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 6,
    marginBottom: 12,
  },
  tabBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#30363d",
    backgroundColor: "#161b22",
  },
  tabBtnActive: {
    backgroundColor: "#238636",
    borderColor: "#238636",
  },
  tabBtnText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#8b949e",
  },
  tabBtnTextActive: {
    color: "#ffffff",
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  txCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#161b22",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#30363d",
    padding: 14,
    marginBottom: 8,
  },
  txIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#0d1117",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  txInfo: {
    flex: 1,
  },
  txDesc: {
    fontSize: 13,
    fontWeight: "600",
    color: "#ffffff",
  },
  txSub: {
    fontSize: 11,
    color: "#8b949e",
    marginTop: 2,
  },
  txAmount: {
    fontSize: 13,
    fontWeight: "700",
  },
  income: {
    color: "#3fb950",
  },
  expense: {
    color: "#ffffff",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#161b22",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    borderTopWidth: 1,
    borderColor: "#30363d",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ffffff",
  },
  kindSelector: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  kindBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#30363d",
    alignItems: "center",
  },
  kindBtnActive: {
    backgroundColor: "#238636",
    borderColor: "#238636",
  },
  kindBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#8b949e",
  },
  kindBtnTextActive: {
    color: "#ffffff",
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#8b949e",
    marginBottom: 4,
  },
  modalInput: {
    backgroundColor: "#0d1117",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#30363d",
    color: "#ffffff",
    paddingHorizontal: 12,
    height: 42,
    fontSize: 13,
    marginBottom: 12,
  },
  saveBtn: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#238636",
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 8,
  },
  saveBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#ffffff",
  },
});
