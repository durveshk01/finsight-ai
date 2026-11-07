import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { RootNavigator } from './src/navigation/RootNavigator';
import { MobileSyncCoordinator } from './src/services/sync';

export default function App() {
  useEffect(() => {
    // Attempt initial sync on app launch in the background
    MobileSyncCoordinator.sync().catch(() => {
      // Offline fallback is handled gracefully by MobileStorage
    });
  }, []);

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar style="light" backgroundColor="#0F172A" />
        <RootNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
