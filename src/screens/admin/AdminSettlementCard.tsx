import { useEffect, useState } from "react";
import { Alert, Image, Linking, StyleSheet, TextInput, TouchableOpacity, View } from "react-native";
import { Button, Text } from "react-native-paper";
import { supabase } from "@/services/supabaseClient";

const CHANNELS = [
  { code: "PH_GCASH", label: "GCash", type: "wallet", logo: require("../../../assets/Payment Logos/Gcash_Logo.png") },
  { code: "PH_MAYA", label: "Maya", type: "wallet", logo: require("../../../assets/Payment Logos/PayMaya_Logo.png") },
  { code: "PH_BDO", label: "BDO Unibank", type: "bank", logo: require("../../../assets/Payment Logos/BDO_Logo.png") },
  { code: "PH_BPI", label: "Bank of the Philippine Islands (BPI)", type: "bank", logo: require("../../../assets/Payment Logos/BPI_Logo.png") },
  { code: "PH_UBP", label: "UnionBank", type: "bank", logo: require("../../../assets/Payment Logos/UnionBank_Logo.png") },
  { code: "PH_METROBANK", label: "Metrobank", type: "bank", logo: require("../../../assets/Payment Logos/MetroBank_Logo.png") },
  { code: "PH_LANDBANK", label: "Landbank of the Philippines", type: "bank", logo: require("../../../assets/Payment Logos/Landbank_logo.png") },
  { code: "PH_PNB", label: "Philippine National Bank (PNB)", type: "bank", logo: require("../../../assets/Payment Logos/PNB_Logo.png") },
  { code: "PH_RCBC", label: "Rizal Commercial Banking Corporation (RCBC)", type: "bank", logo: require("../../../assets/Payment Logos/RCBC_Logo.png") },
  { code: "PH_CHINABANK", label: "China Banking Corporation", type: "bank", logo: require("../../../assets/Payment Logos/Chinabank_Logo.png") },
  { code: "PH_SECURITYBANK", label: "Security Bank", type: "bank", logo: require("../../../assets/Payment Logos/SecurityBank_Logo.png") },
] as const;
type Channel = { code: string; label: string; type: "wallet" | "bank"; logo?: number };
type Account = { channel: "bank" | "ewallet"; provider_name: string; account_holder: string; account_number: string };
const mask = (number: string) => `•••• ${number.slice(-4)}`;

function Logo({ channel }: { channel: Channel }) {
  return <View style={styles.logo}>
    {channel.logo ? <Image source={channel.logo} resizeMode="contain" style={styles.logoImage} /> : <Text style={styles.logoText}>{channel.label.slice(0, 2).toUpperCase()}</Text>}
  </View>;
}

export default function AdminSettlementCard() {
  const [saved, setSaved] = useState<Account | null>(null);
  const [selected, setSelected] = useState<Channel | null>(null);
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data, error } = await supabase.from("admin_settlement_account").select("channel, provider_name, account_holder, account_number").eq("id", 1).maybeSingle();
        if (!active) return;
        if (error) Alert.alert("Receiver account", "Unable to load the account.");
        else setSaved(data as Account | null);
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, []);

  const savedChannel: Channel | null = saved
    ? CHANNELS.find((item) => item.label === saved.provider_name && item.type === (saved.channel === "ewallet" ? "wallet" : "bank"))
      || { code: "saved", label: saved.provider_name, type: saved.channel === "ewallet" ? "wallet" : "bank" }
    : null;
  const openSetup = (channel: Channel) => {
    const same = saved?.provider_name === channel.label && saved.channel === (channel.type === "wallet" ? "ewallet" : "bank");
    setSelected(channel);
    setName(same ? saved.account_holder : "");
    setNumber(same ? saved.account_number : "");
    setVisible(false);
  };

  const save = async () => {
    if (!selected || saving) return;
    const accountHolder = name.trim();
    const accountNumber = number.trim().replace(/[\s-]+/g, "");
    if (accountHolder.length < 2 || accountHolder.length > 120 || !/^[0-9A-Za-z]{6,30}$/.test(accountNumber) || (selected.type === "wallet" && !/^09\d{9}$/.test(accountNumber))) {
      Alert.alert("Check account details", selected.type === "wallet" ? "Enter the registered name and an 11-digit mobile number beginning with 09." : "Enter the registered name and a valid bank account number.");
      return;
    }
    setSaving(true);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw userError || new Error("Please sign in again.");
      const account: Account = { channel: selected.type === "wallet" ? "ewallet" : "bank", provider_name: selected.label, account_holder: accountHolder, account_number: accountNumber };
      const { error } = await supabase.from("admin_settlement_account").upsert({
        id: 1, ...account, updated_at: new Date().toISOString(), updated_by: user.id,
      }, { onConflict: "id" });
      if (error) throw error;
      setSaved(account);
      setSelected(null);
      Alert.alert("Receiver account saved", "Add the same withdrawal destination in your Xendit Dashboard.");
    } catch (error) {
      Alert.alert("Unable to save", error instanceof Error ? error.message : "Please try again.");
    } finally { setSaving(false); }
  };

  if (selected) return <View style={styles.setup}>
    <TouchableOpacity onPress={() => setSelected(null)} accessibilityRole="button"><Text style={styles.back}>← Payout destinations</Text></TouchableOpacity>
    <View style={styles.panel}>
      <View style={styles.setupHeader}><Logo channel={selected} /><View style={styles.flex}><Text style={styles.eyebrow}>{selected.type === "wallet" ? "E-wallet receiver" : "Bank receiver"}</Text><Text style={styles.title}>{saved?.provider_name === selected.label ? "Edit" : "Add"} {selected.label}</Text><Text style={styles.muted}>Set the preferred platform receiver account for {selected.label}.</Text></View></View>
      <View style={styles.form}>
        <View style={styles.readonly}><Text style={styles.label}>Selected destination</Text><Text style={styles.readonlyValue}>{selected.label}</Text></View>
        {saved && saved.provider_name !== selected.label ? <Text style={styles.replace}>Saving this destination will replace the current preferred account ({saved.provider_name}).</Text> : null}
        <Text style={styles.label}>Registered account holder</Text>
        <TextInput style={styles.input} value={name} maxLength={120} onChangeText={setName} placeholder={selected.type === "wallet" ? "Name registered to the wallet" : "Name registered to the bank account"} />
        <Text style={styles.label}>{selected.type === "wallet" ? "Registered mobile number" : "Bank account number"}</Text>
        <TextInput style={styles.input} value={number} maxLength={30} onChangeText={setNumber} keyboardType="number-pad" placeholder={selected.type === "wallet" ? "09XXXXXXXXX" : "Enter account number"} />
        <Text style={styles.muted}>Enter the exact details registered with {selected.label}.</Text>
        <View style={styles.notice}><Text style={styles.noticeTitle}>Xendit setup required</Text><Text style={styles.noticeText}>Saving this record does not configure Xendit withdrawals. Add the same destination in your Xendit Dashboard.</Text></View>
        <View style={styles.actions}><Button onPress={() => setSelected(null)}>Cancel</Button><Button mode="contained" loading={saving} disabled={saving} onPress={() => void save()}>Save receiver account</Button></View>
      </View>
    </View>
  </View>;

  return <View style={styles.container}>
    <View><Text style={styles.eyebrow}>FINANCE</Text><Text style={styles.heading}>Platform receiver account</Text><Text style={styles.muted}>Choose a bank or wallet and record one preferred destination for the LifeCycle Xendit balance.</Text></View>
    {loading ? <Text style={styles.muted}>Loading receiver account...</Text> : <>
      <View style={styles.summary}><View style={styles.summaryItem}><Text style={styles.eyebrow}>ACCOUNTS SET UP</Text><Text style={styles.summaryValue}>{saved ? "1" : "0"}</Text><Text style={styles.muted}>One preferred destination</Text></View><View style={styles.summaryItem}><Text style={styles.eyebrow}>CHECKOUT</Text><Text style={styles.summaryValue}>Xendit</Text><Text style={styles.muted}>Currently in Test Mode</Text></View></View>
      <View style={styles.notice}><Text style={styles.noticeTitle}>Settlement setup</Text><Text style={styles.noticeText}>Shop activation and renewal fees use Xendit checkout. This record does not configure withdrawals.</Text><Button compact onPress={() => void Linking.openURL("https://dashboard.xendit.co/")}>Open Xendit Dashboard</Button></View>
      <View style={styles.panel}><View style={styles.panelHeader}><Text style={styles.eyebrow}>RECEIVER ACCOUNT</Text><Text style={styles.panelTitle}>Preferred destination</Text></View>
        {saved && savedChannel ? <View style={styles.saved}><Logo channel={savedChannel} /><View style={styles.flex}><Text style={styles.eyebrow}>{saved.channel === "ewallet" ? "E-WALLET" : "PHILIPPINE BANK"}</Text><Text style={styles.accountName}>{saved.provider_name}</Text><Text style={styles.muted}>{saved.account_holder}</Text><Text style={styles.muted}>{visible ? saved.account_number : mask(saved.account_number)}</Text><Text style={styles.recorded}>Recorded only</Text><View style={styles.actions}><Button compact onPress={() => setVisible(!visible)}>{visible ? "Hide number" : "Show number"}</Button><Button compact onPress={() => openSetup(savedChannel)}>Edit</Button></View></View></View>
          : <View style={styles.empty}><Text style={styles.panelTitle}>No receiver account yet</Text><Text style={styles.muted}>Choose GCash, Maya, or a Philippine bank below.</Text></View>}
      </View>
      <View style={styles.panel}><View style={styles.panelHeader}><Text style={styles.eyebrow}>PAYOUT DESTINATIONS</Text><Text style={styles.panelTitle}>Add or change a receiver</Text><Text style={styles.muted}>Each option opens its own account details form.</Text></View>
        {(["wallet", "bank"] as const).map((type) => <View style={styles.group} key={type}><Text style={styles.groupTitle}>{type === "wallet" ? "E-wallets" : "Philippine banks"}</Text>{CHANNELS.filter((channel) => channel.type === type).map((channel) => <TouchableOpacity key={channel.code} style={styles.row} onPress={() => openSetup(channel)} accessibilityRole="button"><Logo channel={channel} /><View style={styles.flex}><Text style={styles.accountName}>{saved?.provider_name === channel.label ? channel.label : `Add ${channel.label}`}</Text><Text style={styles.muted}>{saved?.provider_name === channel.label ? `${saved.account_holder} · ${mask(saved.account_number)}` : type === "wallet" ? "Set up an e-wallet receiver" : "Set up a bank receiver account"}</Text></View><Text style={styles.rowState}>{saved?.provider_name === channel.label ? "Recorded" : "Add"}</Text></TouchableOpacity>)}</View>)}
      </View>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  container: { marginTop: 16, gap: 14 },
  setup: { marginTop: 16, gap: 10 },
  flex: { flex: 1, minWidth: 0 },
  eyebrow: { color: "#8995a5", fontSize: 9, fontWeight: "800", letterSpacing: 0.7 },
  heading: { color: "#172b46", fontSize: 21, fontWeight: "800", marginTop: 4 },
  title: { color: "#142842", fontSize: 17, fontWeight: "800", marginTop: 2 },
  muted: { color: "#7a8798", fontSize: 11, lineHeight: 16, marginTop: 3 },
  summary: { flexDirection: "row", gap: 10 },
  summaryItem: { flex: 1, padding: 15, backgroundColor: "#fff", borderWidth: 1, borderColor: "#e2e7ed", borderRadius: 10 },
  summaryValue: { color: "#14263f", fontSize: 20, fontWeight: "800", marginTop: 5 },
  notice: { padding: 14, backgroundColor: "#f4fbf7", borderWidth: 1, borderColor: "#cfe8dc", borderRadius: 9 },
  noticeTitle: { color: "#194f3a", fontSize: 11, fontWeight: "800" },
  noticeText: { color: "#567565", fontSize: 10, lineHeight: 15, marginTop: 4 },
  panel: { overflow: "hidden", borderWidth: 1, borderColor: "#e2e7ed", borderRadius: 10, backgroundColor: "#fff" },
  panelHeader: { padding: 16, borderBottomWidth: 1, borderBottomColor: "#e7ebf0", backgroundColor: "#fafbfd" },
  panelTitle: { color: "#172b46", fontSize: 14, fontWeight: "800", marginTop: 3 },
  logo: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  logoImage: { width: "100%", height: "100%" },
  logoText: { color: "#395879", fontSize: 11, fontWeight: "800" },
  saved: { flexDirection: "row", gap: 12, padding: 16 },
  accountName: { color: "#142842", fontSize: 12, fontWeight: "800", marginTop: 2 },
  recorded: { alignSelf: "flex-start", color: "#91651d", backgroundColor: "#fffaf0", borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4, fontSize: 9, fontWeight: "800", marginTop: 6 },
  empty: { alignItems: "center", padding: 30 },
  group: { paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: "#edf0f4" },
  groupTitle: { color: "#7b8797", fontSize: 10, fontWeight: "800", marginBottom: 5 },
  row: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderTopColor: "#edf0f4", paddingVertical: 8 },
  rowState: { color: "#55708e", fontSize: 9, fontWeight: "800" },
  back: { color: "#344a63", fontSize: 12, fontWeight: "800" },
  setupHeader: { flexDirection: "row", alignItems: "center", gap: 14, padding: 18, backgroundColor: "#fafbfd", borderBottomWidth: 1, borderBottomColor: "#e8ecf1" },
  form: { padding: 18, gap: 12 },
  readonly: { minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingHorizontal: 12, backgroundColor: "#f7f9fb", borderWidth: 1, borderColor: "#e3e8ee", borderRadius: 8 },
  readonlyValue: { color: "#213b58", fontSize: 11, fontWeight: "800", flexShrink: 1, textAlign: "right" },
  replace: { color: "#805a16", fontSize: 11, lineHeight: 16, padding: 10, backgroundColor: "#fffaf0", borderRadius: 8 },
  label: { color: "#4c5c71", fontSize: 11, fontWeight: "800" },
  input: { minHeight: 43, borderWidth: 1, borderColor: "#d9e0e8", borderRadius: 8, paddingHorizontal: 12, color: "#1b2e47" },
  actions: { flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", gap: 4, marginTop: 8 },
});
