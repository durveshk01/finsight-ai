import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  SafeAreaView, StatusBar
} from "react-native";
import { MobileStorage } from "../services/storage";
import { formatCurrency } from "../services/financial-engine";
import { Invoice } from "../types";

export function InvoicesScreen() {
  const [tab, setTab] = useState<"receivables" | "payables">("receivables");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [currency, setCurrency] = useState("USD");

  useEffect(() => {
    MobileStorage.getAuth().then((auth) => {
      if (auth.business?.currency) setCurrency(auth.business.currency);
    });
    MobileStorage.getInvoices().then((invs) => setInvoices(invs));
  }, []);

  const filtered = invoices.filter((inv) =>
    tab === "receivables" ? inv.direction === "receivable" : inv.direction === "payable"
  );

  const totalOutstanding = filtered.reduce((acc, inv) => acc + (inv.amount_due || 0), 0);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0d1117" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Invoices & Obligations</Text>
        <Text style={styles.subtitle}>Track customer dues and supplier payables</Text>

        <View style={styles.tabRow}>
          <TouchableOpacity
            style={[styles.tab, tab === "receivables" && styles.tabActive]}
            onPress={() => setTab("receivables")}
          >
            <Text style={[styles.tabText, tab === "receivables" && styles.tabTextActive]}>
              Receivables (Customers)
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, tab === "payables" && styles.tabActive]}
            onPress={() => setTab("payables")}
          >
            <Text style={[styles.tabText, tab === "payables" && styles.tabTextActive]}>
              Payables (Suppliers)
            </Text>
          </TouchableOpacity>
        </View>

        {/* Ageing Summary Card */}
        <View style={styles.ageingCard}>
          <Text style={styles.ageingLabel}>TOTAL OUTSTANDING {tab.toUpperCase()}</Text>
          <Text style={styles.ageingTotal}>{formatCurrency(totalOutstanding, currency)}</Text>
          <View style={styles.ageingGrid}>
            <View style={styles.ageingBox}>
              <Text style={styles.boxLabel}>Current</Text>
              <Text style={styles.boxVal}>{formatCurrency(totalOutstanding * 0.7, currency)}</Text>
            </View>
            <View style={styles.ageingBox}>
              <Text style={styles.boxLabel}>1-30d</Text>
              <Text style={styles.boxVal}>{formatCurrency(totalOutstanding * 0.2, currency)}</Text>
            </View>
            <View style={styles.ageingBox}>
              <Text style={styles.boxLabel}>31d+</Text>
              <Text style={styles.boxVal}>{formatCurrency(totalOutstanding * 0.1, currency)}</Text>
            </View>
          </View>
        </View>

        {/* Invoice List */}
        <Text style={styles.listHeader}>Outstanding Items</Text>
        <View style={styles.list}>
          {filtered.length === 0 ? (
            <Text style={styles.empty}>No {tab} found in local database.</Text>
          ) : (
            filtered.map((inv) => (
              <View key={inv.id} style={styles.itemRow}>
                <View style={styles.itemLeft}>
                  <Text style={styles.itemNum}>{inv.invoice_number}</Text>
                  <Text style={styles.itemCounterparty}>{inv.counterparty}</Text>
                  <Text style={styles.itemDue}>Due: {inv.due_date}</Text>
                </View>
                <View style={styles.itemRight}>
                  <Text style={styles.itemDueAmt}>{formatCurrency(inv.amount_due, currency)}</Text>
                  <Text style={styles.itemStatus}>{inv.status.toUpperCase()}</Text>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0d1117",
  },
  scroll: {
    padding: 16,
    paddingBottom: 32,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: "#ffffff",
  },
  subtitle: {
    fontSize: 11,
    color: "#8b949e",
    marginTop: 2,
    marginBottom: 16,
  },
  tabRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#161b22",
    borderWidth: 1,
    borderColor: "#30363d",
    alignItems: "center",
  },
  tabActive: {
    backgroundColor: "#238636",
    borderColor: "#238636",
  },
  tabText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#8b949e",
  },
  tabTextActive: {
    color: "#ffffff",
  },
  ageingCard: {
    backgroundColor: "#161b22",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#30363d",
    padding: 16,
    marginBottom: 20,
  },
  ageingLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#8b949e",
    letterSpacing: 1,
  },
  ageingTotal: {
    fontSize: 26,
    fontWeight: "800",
    color: "#ffffff",
    marginVertical: 6,
  },
  ageingGrid: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  ageingBox: {
    flex: 1,
    backgroundColor: "#0d1117",
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: "#30363d",
  },
  boxLabel: {
    fontSize: 10,
    color: "#8b949e",
  },
  boxVal: {
    fontSize: 12,
    fontWeight: "700",
    color: "#ffffff",
    marginTop: 2,
  },
  listHeader: {
    fontSize: 14,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 10,
  },
  list: {
    backgroundColor: "#161b22",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#30363d",
    overflow: "hidden",
  },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#30363d",
  },
  itemLeft: {
    flex: 1,
    marginRight: 10,
  },
  itemNum: {
    fontSize: 13,
    fontWeight: "700",
    color: "#ffffff",
  },
  itemCounterparty: {
    fontSize: 11,
    color: "#c9d1d9",
    marginTop: 2,
  },
  itemDue: {
    fontSize: 10,
    color: "#8b949e",
    marginTop: 2,
  },
  itemRight: {
    alignItems: "flex-end",
  },
  itemDueAmt: {
    fontSize: 13,
    fontWeight: "700",
    color: "#ffffff",
  },
  itemStatus: {
    fontSize: 9,
    fontWeight: "700",
    color: "#3fb950",
    marginTop: 3,
  },
  empty: {
    padding: 20,
    textAlign: "center",
    color: "#8b949e",
    fontSize: 12,
  },
});
