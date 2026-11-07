import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView, StatusBar
} from "react-native";
import { MobileStorage } from "../services/storage";
import { calculateCategoryMix, formatCurrency } from "../services/financial-engine";
import { Transaction } from "../types";

export function AnalyticsScreen() {
  const [expenseCategories, setExpenseCategories] = useState<{ category: string; amount: number; sharePct: number }[]>([]);
  const [currency, setCurrency] = useState("USD");
  const [totalSpend, setTotalSpend] = useState(0);

  useEffect(() => {
    const load = async () => {
      const auth = await MobileStorage.getAuth();
      if (auth.business?.currency) setCurrency(auth.business.currency);

      const txs = await MobileStorage.getTransactions();
      const catMix = calculateCategoryMix(txs, "expense");
      setExpenseCategories(catMix);

      const total = catMix.reduce((acc, c) => acc + c.amount, 0);
      setTotalSpend(total);
    };
    load();
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0d1117" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Spending Analytics</Text>
        <Text style={styles.subTitle}>Computed directly on device from synchronized ledger</Text>

        {/* Total Spend Hero */}
        <View style={styles.heroBox}>
          <Text style={styles.heroLabel}>TOTAL RECORDED SPEND</Text>
          <Text style={styles.heroValue}>{formatCurrency(totalSpend, currency)}</Text>
          <Text style={styles.heroNote}>Categorized across {expenseCategories.length} expense areas</Text>
        </View>

        {/* Category Breakdown Bars */}
        <Text style={styles.sectionHeader}>Category Expense Distribution</Text>
        <View style={styles.breakdownCard}>
          {expenseCategories.length === 0 ? (
            <Text style={styles.empty}>No expense categories recorded yet.</Text>
          ) : (
            expenseCategories.map((item, index) => (
              <View key={item.category} style={styles.catRow}>
                <View style={styles.catHeader}>
                  <Text style={styles.catName}>{item.category}</Text>
                  <Text style={styles.catAmt}>
                    {formatCurrency(item.amount, currency)} ({item.sharePct}%)
                  </Text>
                </View>
                {/* Visual Share Bar */}
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      {
                        width: `${Math.min(100, Math.max(3, item.sharePct))}%`,
                        backgroundColor: index % 2 === 0 ? "#3fb950" : "#58a6ff",
                      },
                    ]}
                  />
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
  subTitle: {
    fontSize: 11,
    color: "#8b949e",
    marginTop: 2,
    marginBottom: 16,
  },
  heroBox: {
    backgroundColor: "#161b22",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#30363d",
    padding: 16,
    marginBottom: 20,
  },
  heroLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#8b949e",
    letterSpacing: 1,
  },
  heroValue: {
    fontSize: 28,
    fontWeight: "800",
    color: "#ffffff",
    marginVertical: 6,
  },
  heroNote: {
    fontSize: 11,
    color: "#58a6ff",
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 10,
  },
  breakdownCard: {
    backgroundColor: "#161b22",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#30363d",
    padding: 16,
  },
  catRow: {
    marginBottom: 14,
  },
  catHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  catName: {
    fontSize: 12,
    fontWeight: "600",
    color: "#ffffff",
  },
  catAmt: {
    fontSize: 11,
    fontWeight: "600",
    color: "#8b949e",
  },
  barTrack: {
    height: 6,
    backgroundColor: "#0d1117",
    borderRadius: 3,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: 3,
  },
  empty: {
    color: "#8b949e",
    fontSize: 12,
    textAlign: "center",
    padding: 16,
  },
});
