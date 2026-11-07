import React from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, SafeAreaView, StatusBar
} from "react-native";
import {
  FileText, Sliders, RefreshCw, Download, Settings,
  ChevronRight, Shield, Database, Users
} from "lucide-react-native";

export function MoreScreen({ navigation }: any) {
  const menuItems = [
    {
      id: "invoices",
      title: "Invoices & AR / AP Ageing",
      subtitle: "Customer receivables, supplier bills & ageing buckets",
      icon: FileText,
      color: "#3fb950",
      screen: "Invoices",
    },
    {
      id: "simulator",
      title: "What-If Scenario Sandbox",
      subtitle: "Simulate revenue growth, hiring, and capex locally",
      icon: Sliders,
      color: "#58a6ff",
      screen: "Simulator",
    },
    {
      id: "sync",
      title: "Cloud Sync & Offline Queue",
      subtitle: "View pending drafts, sync status, and sequence cursor",
      icon: RefreshCw,
      color: "#d29922",
      screen: "Sync",
    },
    {
      id: "reports",
      title: "Financial Reports & Exports",
      subtitle: "PDF, Excel workbook, and CSV downloads",
      icon: Download,
      color: "#a371f7",
      screen: "Reports",
    },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0d1117" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Workspace Tools</Text>
        <Text style={styles.subtitle}>Treasury, synchronization, and scenario management</Text>

        <View style={styles.menuCard}>
          {menuItems.map((item, index) => {
            const Icon = item.icon;
            return (
              <TouchableOpacity
                key={item.id}
                style={[styles.menuRow, index !== menuItems.length - 1 && styles.borderBottom]}
                onPress={() => navigation.navigate(item.screen)}
              >
                <View style={[styles.iconBox, { backgroundColor: `${item.color}15` }]}>
                  <Icon size={18} color={item.color} />
                </View>
                <View style={styles.textContainer}>
                  <Text style={styles.itemTitle}>{item.title}</Text>
                  <Text style={styles.itemSubtitle}>{item.subtitle}</Text>
                </View>
                <ChevronRight size={18} color="#8b949e" />
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Device-Powered Architecture Note */}
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Database size={16} color="#3fb950" />
            <Text style={styles.infoTitle}>Device-Powered Architecture</Text>
          </View>
          <Text style={styles.infoBody}>
            FinSight AI runs computations locally on this phone to give you sub-millisecond responsiveness. Central financial records stay synchronized with Render PostgreSQL when connected.
          </Text>
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
    marginBottom: 20,
  },
  menuCard: {
    backgroundColor: "#161b22",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#30363d",
    overflow: "hidden",
    marginBottom: 20,
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
  },
  borderBottom: {
    borderBottomWidth: 1,
    borderBottomColor: "#30363d",
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  textContainer: {
    flex: 1,
    marginRight: 8,
  },
  itemTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#ffffff",
  },
  itemSubtitle: {
    fontSize: 11,
    color: "#8b949e",
    marginTop: 2,
  },
  infoCard: {
    backgroundColor: "#161b22",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#30363d",
    padding: 16,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  infoTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#3fb950",
  },
  infoBody: {
    fontSize: 11,
    color: "#8b949e",
    lineHeight: 17,
  },
});
