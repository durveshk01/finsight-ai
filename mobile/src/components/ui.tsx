import React, { useRef, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, TextInputProps, RefreshControlProps, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { errorMessage } from "../services/money";

export const colors = { background: "#0d1117", surface: "#161b22", line: "#30363d", text: "#f0f6fc", muted: "#9ba6b3", green: "#3fb950", primary: "#238636", blue: "#58a6ff", red: "#ff7b72", amber: "#e3b341" };

export function Screen({ children, stack = false, refreshControl }: { children: React.ReactNode; stack?: boolean; refreshControl?: React.ReactElement<RefreshControlProps> }) {
  return <SafeAreaView edges={stack ? ["left", "right", "bottom"] : ["top", "left", "right"]} style={s.screen}>
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" refreshControl={refreshControl}>{children}</ScrollView>
  </SafeAreaView>;
}

export function Heading({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return <View style={[s.row, { marginBottom: 18 }]}><View style={{ flex: 1 }}><Text style={s.title}>{title}</Text>{subtitle ? <Text style={s.muted}>{subtitle}</Text> : null}</View>{action}</View>;
}

export function Card({ children }: { children: React.ReactNode }) { return <View style={s.card}>{children}</View>; }

export function Button({ title, onPress, disabled = false, busy = false, variant = "primary", testID }: { title: string; onPress: () => void; disabled?: boolean; busy?: boolean; variant?: "primary" | "secondary" | "danger"; testID?: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: disabled || busy }} testID={testID} disabled={disabled || busy} onPress={onPress}
    style={({ pressed }) => [s.button, variant === "secondary" && s.secondary, variant === "danger" && s.danger, (disabled || busy) && { opacity: 0.45 }, pressed && { opacity: 0.75 }]}>
    {busy ? <ActivityIndicator color={colors.text} /> : <Text style={s.buttonText}>{title}</Text>}
  </Pressable>;
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return <View style={{ marginBottom: 14 }}><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor={colors.muted} autoCorrect={false} {...props} style={[s.input, props.style]} /></View>;
}

export function Choices<T extends string>({ options, selected, onSelect, label }: { options: { value: T; label: string }[]; selected: T; onSelect: (value: T) => void; label?: string }) {
  return <View style={{ marginBottom: 14 }}>{label ? <Text style={s.label}>{label}</Text> : null}<View style={s.wrap}>
    {options.map((option) => <Pressable key={option.value} accessibilityRole="button" accessibilityLabel={option.label} accessibilityState={{ selected: selected === option.value }} onPress={() => onSelect(option.value)} style={[s.choice, selected === option.value && s.choiceActive]}>
      <Text style={{ color: selected === option.value ? colors.text : colors.muted, fontWeight: "600" }}>{option.label}</Text>
    </Pressable>)}
  </View></View>;
}

export function Notice({ text, error = false }: { text: string; error?: boolean }) {
  return <View style={[s.notice, error && { borderColor: colors.red }]}><Text accessibilityLiveRegion="polite" style={{ color: error ? colors.red : colors.muted, lineHeight: 20 }}>{text}</Text></View>;
}

export function Empty({ text }: { text: string }) { return <Text style={[s.muted, { paddingVertical: 20, textAlign: "center" }]}>{text}</Text>; }

export function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <View style={s.metric}><Text style={s.label}>{label}</Text><Text numberOfLines={1} adjustsFontSizeToFit style={[s.metricValue, tone ? { color: tone } : null]}>{value}</Text></View>;
}

export function FormModal({ title, visible, onClose, children }: { title: string; visible: boolean; onClose: () => void; children: React.ReactNode }) {
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.overlay}>
      <SafeAreaView edges={["bottom"]} style={s.modal}>
        <View style={[s.row, { padding: 18 }]}><Text style={[s.title, { flex: 1 }]}>{title}</Text><Button title="Close" variant="secondary" onPress={onClose} /></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 24 }}>{children}</ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  </Modal>;
}

export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  async function run(operation: () => Promise<void>) {
    if (running.current) return;
    running.current = true; setBusy(true); setError(null);
    try { await operation(); } catch (failure) { setError(errorMessage(failure)); }
    finally { running.current = false; setBusy(false); }
  }
  return { busy, error, run, clearError: () => setError(null) };
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 18, paddingBottom: 40, gap: 12 },
  title: { fontSize: 22, fontWeight: "800", color: colors.text },
  section: { fontSize: 16, fontWeight: "700", color: colors.text, marginTop: 8, marginBottom: 8 },
  text: { fontSize: 14, color: colors.text, lineHeight: 21 },
  muted: { fontSize: 13, color: colors.muted, lineHeight: 20, marginTop: 4 },
  label: { fontSize: 12, color: colors.muted, marginBottom: 8, fontWeight: "600" },
  value: { fontSize: 30, fontWeight: "800", color: colors.text, marginVertical: 8 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 16, padding: 18, gap: 8 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: { minHeight: 46, backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  danger: { backgroundColor: "#7d2329", borderWidth: 1, borderColor: "#a12f35" },
  buttonText: { color: colors.text, fontSize: 14, fontWeight: "700", textAlign: "center" },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.background, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, fontSize: 16 },
  choice: { minHeight: 44, paddingHorizontal: 13, paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  choiceActive: { backgroundColor: "#193c2a", borderColor: colors.green },
  notice: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 14, backgroundColor: colors.surface, marginBottom: 8 },
  metric: { width: "48%", flexGrow: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 14 },
  metricValue: { color: colors.text, fontSize: 20, fontWeight: "700" },
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.7)" },
  modal: { maxHeight: "92%", backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 10 },
});
