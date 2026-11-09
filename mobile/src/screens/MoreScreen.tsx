import React from "react";
import { Alert, Text } from "react-native";
import { CompositeScreenProps } from "@react-navigation/native";
import { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Button, Card, Heading, Notice, Screen, s, useAction } from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { MainTabParamList, RootStackParamList } from "../navigation/RootNavigator";

type Props = CompositeScreenProps<BottomTabScreenProps<MainTabParamList, "More">, NativeStackScreenProps<RootStackParamList>>;

export function MoreScreen({ navigation }: Props) {
  const { session, syncing, signOut } = useWorkspace();
  const action = useAction();
  if (!session) return null;
  const logout = () => Alert.alert(session.mode === "local" ? "Close local workspace?" : "Sign out?", "Your workspace records remain on this device. Local workspaces can be resumed; cloud records require signing into the same account again.", [{ text: "Cancel", style: "cancel" }, { text: "Sign out", onPress: () => void action.run(signOut) }]);
  return <Screen>
    <Heading title="Workspace tools" subtitle={`${session.user.name} · ${session.mode === "local" ? "Local owner" : session.role}`} />
    <Card><Button title="Invoices & ageing" testID="open-invoices" variant="secondary" onPress={() => navigation.navigate("Invoices")} /><Text style={s.muted}>Customer invoices, supplier bills, actual due dates, and partial payments.</Text></Card>
    <Card><Button title="Scenario sandbox" testID="open-simulator" variant="secondary" onPress={() => navigation.navigate("Simulator")} /><Text style={s.muted}>Explore cash flow, growth, capital costs, and payment delays.</Text></Card>
    <Card><Button title="Cloud sync & offline queue" testID="open-sync" variant="secondary" onPress={() => navigation.navigate("Sync")} /><Text style={s.muted}>Connection status, acknowledged cursor, and pending changes.</Text></Card>
    <Card><Button title="Reports & exports" testID="open-reports" variant="secondary" onPress={() => navigation.navigate("Reports")} /><Text style={s.muted}>Cash-basis summaries, PDF, Excel, CSV, and portable backups.</Text></Card>
    <Card><Button title="Workspace settings & accounts" testID="open-settings" variant="secondary" onPress={() => navigation.navigate("Settings")} /><Text style={s.muted}>Opening cash, reserve target, currency, and transfer accounts.</Text></Card>
    {action.error ? <Notice error text={action.error} /> : null}
    <Button title={session.mode === "local" ? "Close workspace" : "Sign out"} testID="sign-out" variant="secondary" disabled={syncing} busy={action.busy} onPress={logout} />
    <Text style={s.muted}>FinSight AI 1.1.0 · calculations run on your device. Cloud data is sent only to the API you configure. Local app data is protected by the OS sandbox; bearer tokens use the device keystore.</Text>
  </Screen>;
}
