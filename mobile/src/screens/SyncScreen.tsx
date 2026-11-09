import React, { useState } from "react";
import { Alert, Text, View } from "react-native";
import { Button, Card, Empty, Heading, Notice, Screen, s, useAction } from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";

export function SyncScreen() {
  const { session, workspace, syncing, syncNow, needsSignIn, signOut, discardQueue } = useWorkspace();
  const [notice, setNotice] = useState<string | null>(null);
  const action = useAction();
  if (!session || !workspace) return null;
  const sync = async () => {
    const result = await syncNow();
    if (!result.success) throw new Error(result.error || "Synchronization failed.");
    setNotice(`Acknowledged ${result.pushed} local changes and received ${result.pulled} cloud records/changes.`);
  };
  const discard = () => Alert.alert("Discard pending changes?", "Only unacknowledged local changes will be removed. Cloud records remain. Export your workspace from Reports first if you need to retain these drafts.", [{ text: "Cancel", style: "cancel" }, { text: "Discard", style: "destructive", onPress: () => void action.run(discardQueue) }]);
  return <Screen stack>
    <Heading title="Synchronization" subtitle={session.mode === "local" ? "Device-only workspace" : "Your configured cloud API"} />
    {session.mode === "local" ? <Notice text="This workspace is intentionally local. No cloud account is connected and no records are uploaded. Export a backup from Reports to move your data between devices." /> : <Card>
      <Text style={s.label}>API ADDRESS</Text><Text selectable style={s.text}>{session.apiUrl}</Text>
      <Text style={s.muted}>Last successful pull: {workspace.sync.lastSyncTime ? new Date(workspace.sync.lastSyncTime).toLocaleString() : "Never"}</Text>
      <Text style={s.muted}>Sequence cursor: {workspace.sync.latestSeq} · Role: {session.role}</Text>
      <Text style={s.muted}>{workspace.queue.length} pending changes. An empty queue alone does not confirm cloud connectivity.</Text>
      <Button title="Synchronize now" testID="sync-now" busy={syncing || action.busy} onPress={() => void action.run(sync)} />
      {needsSignIn ? <Button title="Sign in again" variant="secondary" disabled={syncing} onPress={() => void action.run(signOut)} /> : null}
    </Card>}
    {action.error || workspace.sync.lastError ? <Notice error text={action.error || workspace.sync.lastError!} /> : null}
    {notice ? <Notice text={notice} /> : null}
    <Heading title={`Pending changes (${workspace.queue.length})`} />
    {workspace.queue.length ? <>
      {workspace.queue.map((mutation) => <Card key={mutation.client_mutation_id}><Text style={s.text}>{mutation.action.toUpperCase()} {mutation.entity_type}</Text><Text style={s.muted}>{new Date(mutation.created_at).toLocaleString()}</Text><Text style={s.muted}>{String(mutation.data.description || mutation.data.invoice_number || mutation.data.name || "Financial record")}</Text>{mutation.error ? <Notice error text={mutation.error} /> : null}</Card>)}
      <Button title="Discard pending changes" variant="danger" disabled={syncing || action.busy} onPress={discard} />
    </> : <Card><Empty text={session.mode === "local" ? "No cloud queue is used for a local workspace." : "No pending changes. The last successful sync above records when the API was reached."} /></Card>}
    <View><Text style={s.muted}>Cloud mode synchronizes while the app is active: on network reconnection, on foregrounding, and once per minute. Failed pushes remain queued; draft IDs are reconciled only after server acknowledgement.</Text></View>
  </Screen>;
}
