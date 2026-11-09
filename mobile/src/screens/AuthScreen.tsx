import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import { Button, Card, Choices, Field, Heading, Notice, Screen, colors, s, useAction } from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { AuthResponse, apiRequest, normalizeApiUrl, sessionFromAuth } from "../services/api";
import { MobileStorage } from "../services/storage";
import { parseAmount } from "../services/money";
import { CURRENCIES, requireText } from "../services/validation";
import { Business, Session } from "../types";

export function AuthScreen() {
  const { openSession, signOut, startupError } = useWorkspace();
  const [mode, setMode] = useState<"welcome" | "local" | "login" | "register" | "choose">("welcome");
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [openingCash, setOpeningCash] = useState("0");
  const [reserve, setReserve] = useState("0");
  const [apiUrl, setApiUrl] = useState(process.env.EXPO_PUBLIC_API_URL ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState<AuthResponse | null>(null);
  const [localSession, setLocalSession] = useState<Session | null>(null);
  const action = useAction();

  useEffect(() => { MobileStorage.getLocalSession().then(setLocalSession).catch(() => undefined); }, []);

  const chooseBusiness = async (business: Business) => {
    if (!pending) return;
    await openSession(sessionFromAuth(pending, normalizeApiUrl(apiUrl), business));
    setPassword(""); setPending(null);
  };

  const submit = async () => {
    if (mode === "local") {
      const business: Business = { id: -1, name: requireText(businessName, "Workspace name"), currency,
        opening_cash: parseAmount(openingCash || "0", true, true), minimum_reserve: parseAmount(reserve || "0", true) };
      const session: Session = { workspaceId: `local.${Crypto.randomUUID()}`, mode: "local", apiUrl: null, token: null,
        user: { id: -1, name: requireText(name, "Your name", 2, 120), email: "" }, business, role: "owner" };
      await MobileStorage.updateWorkspace(session, (data) => ({ ...data, nextId: -2, snapshot: { ...data.snapshot, accounts: [{ id: -1, name: "Operating cash", account_type: "cash", currency, opening_balance: business.opening_cash, is_active: true }] } }));
      await openSession(session);
      return;
    }
    const base = normalizeApiUrl(apiUrl);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Error("Enter a valid email address.");
    if (password.length < 8 || password.length > 128) throw new Error("Password must contain 8–128 characters.");
    const body = mode === "register" ? {
      email: email.trim().toLowerCase(), password, name: requireText(name, "Your name", 2, 120),
      business_name: requireText(businessName, "Workspace name"), currency,
    } : { email: email.trim().toLowerCase(), password };
    const response = await apiRequest<AuthResponse>(base, `/api/auth/${mode === "register" ? "register" : "login"}`, body);
    const businesses = response.business ? [response.business] : response.businesses ?? [];
    setPassword("");
    if (businesses.length === 1) await openSession(sessionFromAuth(response, base, businesses[0]));
    else { setPending(response); setMode("choose"); }
  };

  const newCloudBusiness = async () => {
    if (!pending) return;
    const placeholder: Business = { id: 0, name: "", currency, opening_cash: 0, minimum_reserve: 0 };
    const temporary: Session = { workspaceId: "", mode: "cloud", apiUrl: normalizeApiUrl(apiUrl), token: pending.access_token, user: pending.user, business: placeholder, role: "viewer" };
    const business = await apiRequest<Business>(temporary.apiUrl!, "/api/businesses", { name: requireText(businessName, "Workspace name"), currency, opening_cash: 0, minimum_reserve: 0 }, temporary);
    await chooseBusiness(business);
  };

  const changeMode = (next: typeof mode) => { action.clearError(); setMode(next); setPassword(""); setPending(null); };

  return <Screen>
    <View style={{ paddingTop: 28, paddingBottom: 20 }}><Text style={{ color: colors.green, fontWeight: "800", letterSpacing: 2 }}>FINSIGHT AI</Text>
      <Text style={[s.value, { marginTop: 16 }]}>Your money.{"\n"}A clearer picture.</Text>
      <Text style={s.muted}>Track real activity, manage invoices, and plan cash flow on your phone.</Text>
    </View>
    {startupError ? <><Notice text={startupError} error /><Button title="Reset saved sign-in" variant="secondary" onPress={() => void action.run(signOut)} /></> : null}
    {action.error ? <Notice text={action.error} error /> : null}
    {mode === "welcome" ? <>
      <Card><Text style={s.section}>Start on this device</Text><Text style={s.muted}>A private local workspace with your own records. No account or internet required. Export backups from Reports.</Text>
        <Button title="Create local workspace" testID="create-local-workspace" onPress={() => changeMode("local")} />
        {localSession ? <Button title={`Resume ${localSession.business.name}`} variant="secondary" busy={action.busy} onPress={() => void action.run(() => openSession(localSession))} /> : null}
      </Card>
      <Card><Text style={s.section}>Connect a cloud account</Text><Text style={s.muted}>Sign in to your deployed FinSight API. Cloud credentials are protected by the device keystore.</Text>
        <Button title="Cloud sign in" variant="secondary" onPress={() => changeMode("login")} />
      </Card>
    </> : mode === "choose" ? <Card>
      <Heading title="Choose a workspace" />
      {(pending?.businesses ?? []).map((business) => <Button key={business.id} title={`Open ${business.name}`} busy={action.busy} onPress={() => void action.run(() => chooseBusiness(business))} />)}
      <Field label="New workspace name" value={businessName} onChangeText={setBusinessName} />
      <Choices label="Currency" options={CURRENCIES.map((value) => ({ value, label: value }))} selected={currency} onSelect={setCurrency} />
      <Button title="Create cloud workspace" busy={action.busy} onPress={() => void action.run(newCloudBusiness)} />
      <Button title="Back" variant="secondary" disabled={action.busy} onPress={() => changeMode("welcome")} />
    </Card> : <Card>
      <Heading title={mode === "local" ? "Your local workspace" : mode === "register" ? "Create cloud account" : "Cloud sign in"} />
      {mode !== "local" ? <><Field label="HTTPS API address" testID="api-address" placeholder="https://your-finsight-api.example.com" value={apiUrl} onChangeText={setApiUrl} keyboardType="url" autoCapitalize="none" />
        <Field label="Email" placeholder="you@example.com" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" textContentType="emailAddress" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry textContentType={mode === "register" ? "newPassword" : "password"} />
      </> : null}
      {mode !== "login" ? <><Field label="Your name" testID="owner-name" value={name} onChangeText={setName} maxLength={120} />
        <Field label="Workspace name" testID="workspace-name" value={businessName} onChangeText={setBusinessName} maxLength={180} />
        <Choices label="Currency" options={CURRENCIES.map((value) => ({ value, label: value }))} selected={currency} onSelect={setCurrency} />
      </> : null}
      {mode === "local" ? <><Field label={`Opening cash (${currency})`} testID="opening-cash" value={openingCash} onChangeText={setOpeningCash} keyboardType="decimal-pad" />
        <Field label={`Minimum reserve (${currency})`} testID="minimum-reserve" value={reserve} onChangeText={setReserve} keyboardType="decimal-pad" />
        <Text style={s.muted}>Local mode stores data only on this phone; it does not upload or claim to synchronize with a server.</Text>
      </> : null}
      <Button title={mode === "local" ? "Open workspace" : mode === "register" ? "Create account" : "Sign in"} testID="submit-auth" busy={action.busy} onPress={() => void action.run(submit)} />
      {mode !== "local" ? <Button title={mode === "login" ? "Create a cloud account" : "Already have an account? Sign in"} variant="secondary" disabled={action.busy} onPress={() => changeMode(mode === "login" ? "register" : "login")} /> : null}
      <Button title="Back" variant="secondary" disabled={action.busy} onPress={() => changeMode("welcome")} />
    </Card>}
  </Screen>;
}
