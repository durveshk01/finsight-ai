import React from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ArrowLeftRight, ChartPie, House, Menu, TrendingUp } from "lucide-react-native";
import { colors, s } from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { AuthScreen } from "../screens/AuthScreen";
import { HomeScreen } from "../screens/HomeScreen";
import { TransactionsScreen } from "../screens/TransactionsScreen";
import { AnalyticsScreen } from "../screens/AnalyticsScreen";
import { ForecastsScreen } from "../screens/ForecastsScreen";
import { MoreScreen } from "../screens/MoreScreen";
import { InvoicesScreen } from "../screens/InvoicesScreen";
import { SimulatorScreen } from "../screens/SimulatorScreen";
import { SyncScreen } from "../screens/SyncScreen";
import { ReportsScreen } from "../screens/ReportsScreen";
import { SettingsScreen } from "../screens/SettingsScreen";

export type RootStackParamList = {
  MainTabs: undefined;
  Invoices: undefined;
  Simulator: undefined;
  Sync: undefined;
  Reports: undefined;
  Settings: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Transactions: { compose?: boolean } | undefined;
  Analytics: undefined;
  Forecasts: undefined;
  More: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();
const icons = { Home: House, Transactions: ArrowLeftRight, Analytics: ChartPie, Forecasts: TrendingUp, More: Menu };

function MainTabs() {
  return <Tab.Navigator screenOptions={({ route }) => ({
    headerShown: false,
    tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
    tabBarActiveTintColor: colors.green,
    tabBarInactiveTintColor: colors.muted,
    tabBarLabelStyle: { fontSize: 10, fontWeight: "600" },
    tabBarButtonTestID: `tab-${route.name.toLowerCase()}`,
    tabBarIcon: ({ color, size }) => { const Icon = icons[route.name]; return <Icon size={size} color={color} />; },
  })}>
    <Tab.Screen name="Home" component={HomeScreen} />
    <Tab.Screen name="Transactions" component={TransactionsScreen} options={{ title: "Activity" }} />
    <Tab.Screen name="Analytics" component={AnalyticsScreen} />
    <Tab.Screen name="Forecasts" component={ForecastsScreen} />
    <Tab.Screen name="More" component={MoreScreen} />
  </Tab.Navigator>;
}

export function RootNavigator() {
  const { session, loading } = useWorkspace();
  if (loading) return <View style={[s.screen, { alignItems: "center", justifyContent: "center", gap: 16 }]}><ActivityIndicator size="large" color={colors.green} /><Text style={s.text}>Opening FinSight AI…</Text></View>;
  if (!session) return <AuthScreen />;
  return <Stack.Navigator key={session.workspaceId} screenOptions={{ headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.text, headerTitleStyle: { fontWeight: "700" }, contentStyle: { backgroundColor: colors.background } }}>
    <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
    <Stack.Screen name="Invoices" component={InvoicesScreen} options={{ title: "Invoices & payments" }} />
    <Stack.Screen name="Simulator" component={SimulatorScreen} options={{ title: "Scenario sandbox" }} />
    <Stack.Screen name="Sync" component={SyncScreen} options={{ title: "Cloud synchronization" }} />
    <Stack.Screen name="Reports" component={ReportsScreen} options={{ title: "Reports & exports" }} />
    <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: "Workspace settings" }} />
  </Stack.Navigator>;
}
