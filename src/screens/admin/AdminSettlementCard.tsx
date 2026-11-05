import { useEffect, useState } from "react";
import { Alert, Linking, StyleSheet, TextInput, View } from "react-native";
import { Button, Text } from "react-native-paper";
import { supabase } from "@/services/supabaseClient";

type Account = { channel: "bank" | "ewallet"; provider_name: string; account_holder: string; account_number: string };
const blank: Account = { channel: "bank", provider_name: "", account_holder: "", account_number: "" };

export default function AdminSettlementCard() {
  const [account, setAccount] = useState<Account>(blank);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.from("admin_settlement_account").select("channel, provider_name, account_holder, account_number").eq("id", 1).maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) { Alert.alert("Receiver account", "Unable to load the account."); return; }
        if (data) { setAccount(data as Account); setSaved(true); }
      });
    return () => { active = false; };
  }, []);

  const save = async () => {
    if (busy) return;
    if (account.provider_name.trim().length < 2 || account.account_holder.trim().length < 2 || !/^[0-9A-Za-z -]{6,40}$/.test(account.account_number.trim())) {
      Alert.alert("Check account details", "Enter a provider, holder, and a valid account or mobile number.");
      return;
    }
    setBusy(true);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw userError || new Error("Please sign in again.");
      const { error } = await supabase.from("admin_settlement_account").upsert({
        id: 1, channel: account.channel, provider_name: account.provider_name.trim(),
        account_holder: account.account_holder.trim(), account_number: account.account_number.trim(),
        updated_at: new Date().toISOString(), updated_by: user.id,
      }, { onConflict: "id" });
      if (error) throw error;
      setSaved(true); setEditing(false); setVisible(false);
    } catch (error) {
      Alert.alert("Unable to save", error instanceof Error ? error.message : "Please try again.");
    } finally { setBusy(false); }
  };

  return <View style={styles.card}>
    <Text style={styles.title}>Platform receiver account</Text>
    <Text style={styles.subtitle}>Record the bank or wallet used for withdrawals from the LifeCycle Xendit balance.</Text>
    {saved && !editing ? <View style={styles.preview}>
      <Text style={styles.previewLabel}>LIFECYCLE · {account.channel === "bank" ? "BANK" : "E-WALLET"}</Text>
      <Text style={styles.previewProvider}>{account.provider_name}</Text>
      <Text style={styles.previewText}>{account.account_holder}</Text>
      <View style={styles.numberRow}>
        <Text style={styles.previewNumber}>{visible ? account.account_number : `•••• ${account.account_number.slice(-4)}`}</Text>
        <Button textColor="#ffffff" compact onPress={() => setVisible(!visible)}>{visible ? "Hide" : "Show"}</Button>
      </View>
    </View> : null}
    {!saved || editing ? <View style={styles.form}>
      <Text style={styles.label}>Account type</Text>
      <View style={styles.switchRow}>
        <Button mode={account.channel === "bank" ? "contained" : "outlined"} onPress={() => setAccount({ ...account, channel: "bank" })}>Bank</Button>
        <Button mode={account.channel === "ewallet" ? "contained" : "outlined"} onPress={() => setAccount({ ...account, channel: "ewallet" })}>E-wallet</Button>
      </View>
      <Text style={styles.label}>Bank or wallet provider</Text>
      <TextInput style={styles.input} value={account.provider_name} maxLength={80} onChangeText={(value) => setAccount({ ...account, provider_name: value })} placeholder="e.g. BDO Unibank" />
      <Text style={styles.label}>Account holder name</Text>
      <TextInput style={styles.input} value={account.account_holder} maxLength={120} onChangeText={(value) => setAccount({ ...account, account_holder: value })} placeholder="Registered account name" />
      <Text style={styles.label}>Account or mobile number</Text>
      <TextInput style={styles.input} value={account.account_number} maxLength={40} onChangeText={(value) => setAccount({ ...account, account_number: value })} placeholder="Account number" />
      <View style={styles.switchRow}>
        {saved ? <Button onPress={() => setEditing(false)}>Cancel</Button> : null}
        <Button mode="contained" loading={busy} disabled={busy} onPress={() => void save()}>Save account</Button>
      </View>
    </View> : <Button style={styles.edit} mode="outlined" onPress={() => setEditing(true)}>Edit account</Button>}
    <Text style={styles.note}>Shop activation and renewal fees use Xendit checkout. This record does not configure Xendit withdrawals. Add the same account in the Xendit Dashboard. Checkout is currently in Test Mode.</Text>
    <Button onPress={() => void Linking.openURL("https://dashboard.xendit.co/")}>Open Xendit Dashboard</Button>
  </View>;
}

const styles = StyleSheet.create({
  card: { marginTop: 16, backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#e2e8f0", padding: 16 },
  title: { fontSize: 16, fontWeight: "800", color: "#1f2937" },
  subtitle: { marginTop: 4, fontSize: 12, color: "#64748b" },
  preview: { marginTop: 16, padding: 20, borderRadius: 14, backgroundColor: "#203b3b", gap: 6 },
  previewLabel: { color: "#cbd5d1", fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  previewProvider: { marginTop: 12, color: "#fff", fontSize: 19, fontWeight: "800" },
  previewText: { color: "#dbe5e1", fontSize: 13 },
  previewNumber: { color: "#fff", fontSize: 18, fontWeight: "700" },
  numberRow: { marginTop: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  form: { marginTop: 16, gap: 8 },
  label: { fontSize: 12, fontWeight: "700", color: "#475569", marginTop: 6 },
  input: { borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, paddingHorizontal: 12, minHeight: 42, color: "#1e293b" },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  edit: { alignSelf: "flex-start", marginTop: 12 },
  note: { color: "#64748b", fontSize: 12, lineHeight: 18, marginTop: 16 },
});
