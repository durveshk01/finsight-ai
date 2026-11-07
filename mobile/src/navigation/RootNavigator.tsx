import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { HomeScreen } from '../screens/HomeScreen';
import { TransactionsScreen } from '../screens/TransactionsScreen';
import { AnalyticsScreen } from '../screens/AnalyticsScreen';
import { ForecastsScreen } from '../screens/ForecastsScreen';
import { MoreScreen } from '../screens/MoreScreen';
import { InvoicesScreen } from '../screens/InvoicesScreen';
import { SimulatorScreen } from '../screens/SimulatorScreen';
import { SyncScreen } from '../screens/SyncScreen';
import { ReportsScreen } from '../screens/ReportsScreen';

export type RootStackParamList = {
  MainTabs: undefined;
  Invoices: undefined;
  Simulator: undefined;
  Sync: undefined;
  Reports: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Transactions: undefined;
  Analytics: undefined;
  Forecasts: undefined;
  More: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

// Custom text/emoji icon badge component for clean dependency-free rendering
const TabIcon: React.FC<{ symbol: string; focused: boolean; label: string }> = ({
  symbol,
  focused,
  label,
}) => {
  return (
    <View style={styles.iconContainer}>
      <Text style={[styles.symbol, focused && styles.symbolActive]}>{symbol}</Text>
      <Text style={[styles.label, focused && styles.labelActive]}>{label}</Text>
    </View>
  );
};

const MainTabs: React.FC = () => {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: styles.tabBar,
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon symbol="⊞" focused={focused} label="Home" />
          ),
        }}
      />
      <Tab.Screen
        name="Transactions"
        component={TransactionsScreen}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon symbol="⇄" focused={focused} label="Activity" />
          ),
        }}
      />
      <Tab.Screen
        name="Analytics"
        component={AnalyticsScreen}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon symbol="◔" focused={focused} label="Analytics" />
          ),
        }}
      />
      <Tab.Screen
        name="Forecasts"
        component={ForecastsScreen}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon symbol="↗" focused={focused} label="Forecasts" />
          ),
        }}
      />
      <Tab.Screen
        name="More"
        component={MoreScreen}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon symbol="☰" focused={focused} label="More" />
          ),
        }}
      />
    </Tab.Navigator>
  );
};

export const RootNavigator: React.FC = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: '#0F172A',
        },
        headerTintColor: '#FFFFFF',
        headerTitleStyle: {
          fontWeight: '700',
        },
      }}
    >
      <Stack.Screen
        name="MainTabs"
        component={MainTabs}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Invoices"
        component={InvoicesScreen}
        options={{ title: 'Invoices & Receivables' }}
      />
      <Stack.Screen
        name="Simulator"
        component={SimulatorScreen}
        options={{ title: 'Scenario Sandbox' }}
      />
      <Stack.Screen
        name="Sync"
        component={SyncScreen}
        options={{ title: 'Cloud Synchronization' }}
      />
      <Stack.Screen
        name="Reports"
        component={ReportsScreen}
        options={{ title: 'Financial Reports' }}
      />
    </Stack.Navigator>
  );
};

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#FFFFFF',
    borderTopColor: '#E2E8F0',
    borderTopWidth: 1,
    height: 60,
    elevation: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 4,
  },
  symbol: {
    fontSize: 20,
    color: '#64748B',
    lineHeight: 22,
  },
  symbolActive: {
    color: '#059669',
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 2,
  },
  labelActive: {
    color: '#059669',
    fontWeight: '700',
  },
});
