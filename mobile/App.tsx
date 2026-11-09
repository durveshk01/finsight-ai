import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { RootNavigator } from './src/navigation/RootNavigator';
import { WorkspaceProvider } from './src/context/WorkspaceContext';
import { colors } from './src/components/ui';

const theme = { ...DarkTheme, colors: { ...DarkTheme.colors, primary: colors.green, background: colors.background, card: colors.surface, text: colors.text, border: colors.line } };

export default function App() {
  return (
    <SafeAreaProvider>
      <WorkspaceProvider>
        <NavigationContainer theme={theme}>
          <StatusBar style="light" />
          <RootNavigator />
        </NavigationContainer>
      </WorkspaceProvider>
    </SafeAreaProvider>
  );
}
