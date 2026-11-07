import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, SafeAreaView, StatusBar
} from "react-native";
import {
  Activity, ArrowUpRight, ArrowDownRight, Clock,
  ShieldAlert, Sparkles, Wallet, RefreshCw, Plus
} from "lucide-react-native";
import { MobileStorage } from "../services/storage";
import { calculateMobileKpis, formatCurrency } from "../services/financial-engine";
import { syncService } from "../services/sync";
import { MobileKpis, Transaction } from "../types";

export function HomeScreen({ navigation }: any) {
  const [kpis, setKpis] = useState<MobileKpis | null>(null);
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [businessName, setBusinessName] = useState("My Business");
  const [currency, setCurrency] = useState("USD");
  const [lastSync, setLastSync] = useState<string | null>(null);

  const loadLocalData = async () => {
    const auth = await MobileStorage.getAuth();
    if (auth.business) {
      setBusinessName(auth.business.name);
      setCurrency(auth.business.currency || "USD");
    }

    const txs = await MobileStorage.getTransactions();
    const invs = await MobileStorage.getInvoices();
    const meta = await MobileStorage.getSyncMeta();
    setLastSync(meta.lastSyncTime);

    const calculated = calculateMobileKpis(
      txs,
      invs,
      auth.business?.opening_cash ? Number(auth.business.opening_cash) : 50000,
      auth.business?.minimum_reserve ? Number(auth.business.minimum_reserve) : 25000
    );

    setKpis(calculated);
    setRecentTransactions(txs.slice(0, 5));
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await syncService.sync();
    await loadLocalData();
    setRefreshing(false);
  };

  useEffect(() => {
    loadLocalData();
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0d1117" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#238636" />}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.businessSubtitle}>FINSIGHT AI · MOBILE</Text>
            <Text style={styles.businessTitle}>{businessName}</Text>
          </View>
          <TouchableOpacity style={styles.syncBtn} onPress={onRefresh}>
            <RefreshCw size={16} color="#8b949e" />
          </TouchableOpacity>
        </View>

        {/* Sync Status Banner */}
        <View style={styles.syncBanner}>
          <View style={styles.onlineDot} />
          <Text style={styles.syncText}>
            Local-first engine active · {lastSync ? `Synced ${new Date(lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : "Ready to sync"}
          </Text>
        </View>

        {/* Main Cash Balance Hero Card */}
        <View style={styles.heroCard}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardLabel}>CURRENT OPERATING CASH</Text>
            <Wallet size={18} color="#3fb950" />
          </View>
          <Text style={styles.heroAmount}>{formatCurrency(kpis?.currentCash ?? 0, currency)}</Text>
          <View style={styles.heroFooter}>
            <View style={styles.badgeRow}>
              <Text style={styles.heroSubText}>
                Net Cash Flow: {formatCurrency(kpis?.netCashFlow ?? 0, currency)}
              </Text>
              <Text style={styles.marginBadge}>{kpis?.cashMarginPct ?? 0}% Margin</Text>
            </View>
          </View>
        </View>

        {/* Cash Reserve Warning Banner if balance low */}
        {kpis && kpis.currentCash < kpis.minimumReserve && (
          <View style={styles.warningBanner}>
            <ShieldAlert size={18} color="#f85149" />
            <Text style={styles.warningText}>
              Warning: Cash is below minimum target of {formatCurrency(kpis.minimumReserve, currency)}.
            </Text>
          </View>
        )}

        {/* 4 Secondary KPIs Grid */}
        <View style={styles.kpiGrid}>
          <View style={styles.kpiBox}>
            <View style={styles.kpiBoxHeader}>
              <Text style={styles.kpiBoxLabel}>Revenue</Text>
              <ArrowUpRight size={14} color="#3fb950" />
            </View>
            <Text style={styles.kpiBoxValue}>{formatCurrency(kpis?.revenue ?? 0, currency)}</Text>
          </View>

          <View style={styles.kpiBox}>
            <View style={styles.kpiBoxHeader}>
              <Text style={styles.kpiBoxLabel}>Expenses</Text>
              <ArrowDownRight size={14} color="#8b949e" />
            </View>
            <Text style={styles.kpiBoxValue}>{formatCurrency(kpis?.expenses ?? 0, currency)}</Text>
          </View>

          <View style={styles.kpiBox}>
            <View style={styles.kpiBoxHeader}>
              <Text style={styles.kpiBoxLabel}>Receivables</Text>
              <Clock size={14} color="#58a6ff" />
            </View>
            <Text style={styles.kpiBoxValue}>{formatCurrency(kpis?.accountsReceivable ?? 0, currency)}</Text>
          </View>

          <View style={styles.kpiBox}>
            <View style={styles.kpiBoxHeader}>
              <Text style={styles.kpiBoxLabel}>Cash Runway</Text>
              <Activity size={14} color="#3fb950" />
            </View>
            <Text style={styles.kpiBoxValue}>
              {kpis?.cashRunwayDays ? `${kpis.cashRunwayDays}d` : "Healthy"}
            </Text>
          </View>
        </View>

        {/* Recent Transactions List */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Activity</Text>
          <TouchableOpacity onPress={() => navigation.navigate("Transactions")}>
            <Text style={styles.seeAllText}>See all &rarr;</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.listContainer}>
          {recentTransactions.length === 0 ? (
            <Text style={styles.emptyText}>No transactions recorded yet.</Text>
          ) : (
            recentTransactions.map((tx) => (
              <View key={tx.id} style={styles.txRow}>
                <View style={styles.txLeft}>
                  <Text style={styles.txDesc} numberOfLines={1}>
                    {tx.description || tx.category}
                  </Text>
                  <Text style={styles.txMeta}>
                    {tx.date} · {tx.category} {tx.is_offline_draft ? "· (Draft)" : ""}
                  </Text>
                </View>
                <Text style={[styles.txAmount, tx.kind === "income" ? styles.incomeText : styles.expenseText]}>
                  {tx.kind === "income" ? "+" : tx.kind === "expense" ? "−" : "⇄"}{formatCurrency(tx.amount, currency)}
                </Text>
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
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  businessSubtitle: {
    fontSize: 10,
    fontWeight: "700",
    color: "#238636",
    letterSpacing: 1.2,
  },
  businessTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#ffffff",
    marginTop: 2,
  },
  syncBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: "#161b22",
    borderWidth: 1,
    borderColor: "#30363d",
  },
  syncBanner: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    marginTop: 4,
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#3fb950",
    marginRight: 6,
  },
  syncText: {
    fontSize: 11,
    color: "#8b949e",
  },
  heroCard: {
    backgroundColor: "#161b22",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#30363d",
    padding: 18,
    marginBottom: 14,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#8b949e",
    letterSpacing: 1,
  },
  heroAmount: {
    fontSize: 32,
    fontWeight: "800",
    color: "#ffffff",
    marginVertical: 10,
  },
  heroFooter: {
    borderTopWidth: 1,
    borderTopColor: "#30363d",
    paddingTop: 10,
  },
  badgeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  heroSubText: {
    fontSize: 12,
    color: "#3fb950",
    fontWeight: "600",
  },
  marginBadge: {
    fontSize: 11,
    color: "#8b949e",
  },
  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#f8514915",
    borderWidth: 1,
    borderColor: "#f8514940",
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  warningText: {
    fontSize: 11,
    color: "#f85149",
    flex: 1,
  },
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 20,
  },
  kpiBox: {
    flex: 1,
    minWidth: "47%",
    backgroundColor: "#161b22",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#30363d",
    padding: 14,
  },
  kpiBoxHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  kpiBoxLabel: {
    fontSize: 11,
    color: "#8b949e",
  },
  kpiBoxValue: {
    fontSize: 17,
    fontWeight: "700",
    color: "#ffffff",
    marginTop: 6,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#ffffff",
  },
  seeAllText: {
    fontSize: 12,
    color: "#58a6ff",
    fontWeight: "600",
  },
  listContainer: {
    backgroundColor: "#161b22",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#30363d",
    overflow: "hidden",
  },
  txRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#30363d",
  },
  txLeft: {
    flex: 1,
    marginRight: 12,
  },
  txDesc: {
    fontSize: 13,
    fontWeight: "600",
    color: "#ffffff",
  },
  txMeta: {
    fontSize: 11,
    color: "#8b949e",
    marginTop: 2,
  },
  txAmount: {
    fontSize: 13,
    fontWeight: "700",
  },
  incomeText: {
    color: "#3fb950",
  },
  expenseText: {
    color: "#ffffff",
  },
  emptyText: {
    padding: 24,
    textAlign: "center",
    color: "#8b949e",
    fontSize: 12,
  },
});
