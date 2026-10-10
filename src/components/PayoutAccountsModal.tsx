import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import KeyboardAwareScrollView from "@/components/KeyboardAwareScrollView";
import { supabase } from "@/services/supabaseClient";
import { sanitizePlainText } from "@/utils/inputSecurity";

const CHANNELS = [
  { code: "PH_GCASH", label: "GCash", type: "wallet" },
  { code: "PH_MAYA", label: "Maya", type: "wallet" },
  { code: "PH_BDO", label: "BDO Unibank", type: "bank" },
  { code: "PH_BPI", label: "Bank of the Philippine Islands (BPI)", type: "bank" },
  { code: "PH_UBP", label: "UnionBank of the Philippines", type: "bank" },
  { code: "PH_METROBANK", label: "Metrobank", type: "bank" },
  { code: "PH_LANDBANK", label: "Landbank of the Philippines", type: "bank" },
  { code: "PH_PNB", label: "Philippine National Bank (PNB)", type: "bank" },
  { code: "PH_RCBC", label: "Rizal Commercial Banking Corporation (RCBC)", type: "bank" },
  { code: "PH_CHINABANK", label: "China Banking Corporation", type: "bank" },
] as const;

type Channel = (typeof CHANNELS)[number];
type Account = {
  id: string; shopId: string; channelCode: string; accountName: string; accountNumber: string;
  active: boolean; verifiedByAdmin: boolean; verifiedAt: string | null; createdAt: string; updatedAt: string;
};
type Props = { visible: boolean; shopId?: string | null; shopApproved: boolean; onClose: () => void; onChanged?: () => void | Promise<void> };

const mask = (value?: string | null) => {
  const clean = String(value || "").trim();
  return clean.length > 4 ? `${"•".repeat(Math.min(6, clean.length - 4))}${clean.slice(-4)}` : clean || "Not provided";
};
const initials = (channel: Channel) => channel.code === "PH_GCASH" ? "G" : channel.code === "PH_MAYA" ? "M" : channel.label.split(" ").map((part) => part[0]).join("").slice(0, 3).toUpperCase();
const verifiedDate = (value?: string | null) => value && !Number.isNaN(new Date(value).getTime())
  ? new Date(value).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : null;

async function functionError(error: unknown, fallback: string) {
  const context = (error as { context?: Response } | null)?.context;
  if (context && typeof context.json === "function") {
    try {
      const body = await context.json();
      if (typeof body?.error === "string" && body.error.trim()) return body.error;
    } catch { /* use fallback */ }
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function PayoutAccountsModal({ visible, shopId, shopApproved, onClose, onChanged }: Props) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState<"list" | "setup">("list");
  const [channelCode, setChannelCode] = useState<string>(CHANNELS[0].code);
  const [draft, setDraft] = useState({ name: "", number: "" });
  const channel = useMemo(() => CHANNELS.find((item) => item.code === channelCode) || CHANNELS[0], [channelCode]);

  const load = useCallback(async () => {
    if (!shopId) { setAccounts([]); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.from("funeral_shop_payout_accounts")
        .select('id, "shopId", "channelCode", "accountName", "accountNumber", active, "verifiedByAdmin", "verifiedAt", "createdAt", "updatedAt"')
        .eq("shopId", shopId).order("createdAt", { ascending: true });
      if (error) throw error;
      setAccounts(((data || []) as Account[]).filter((account) => CHANNELS.some((item) => item.code === account.channelCode)));
    } catch (error: any) {
      Alert.alert("Payout accounts unavailable", error?.message || "Unable to load payout accounts.");
    } finally { setLoading(false); }
  }, [shopId]);

  useEffect(() => {
    if (!visible) return;
    const refreshTimer = setTimeout(() => void load(), 0);
    return () => clearTimeout(refreshTimer);
  }, [load, visible]);

  const openSetup = (next: Channel) => {
    const account = accounts.find((item) => item.channelCode === next.code);
    setChannelCode(next.code);
    setDraft({ name: account?.accountName || "", number: account?.accountNumber || "" });
    setPage("setup");
  };

  const save = async () => {
    if (!shopId || saving) return;
    const name = sanitizePlainText(draft.name, 120);
    const number = draft.number.trim().replace(/[\s-]+/g, "");
    if (name.length < 2) return Alert.alert("Check account name", "Enter the registered account holder name.");
    if (number.length < 4 || number.length > 30) return Alert.alert("Check account number", channel.type === "wallet" ? "Enter the mobile number registered to this e-wallet." : "Enter a valid bank account number.");
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("provision-xendit-shop", { body: {
        shopId, action: "update", payoutChannelCode: channel.code, payoutAccountName: name, payoutAccountNumber: number,
      } });
      if (error) throw new Error(await functionError(error, "Unable to save the payout account."));
      if (!data || data.shopId !== shopId) throw new Error("The payout account could not be confirmed.");
      await load(); await onChanged?.(); setPage("list");
      Alert.alert("Payout account submitted", "The account is waiting for administrator verification. Customers cannot use it until it is verified.");
    } catch (error: any) { Alert.alert("Save failed", error?.message || "Unable to save the payout account."); }
    finally { setSaving(false); }
  };

  const toggle = async (account: Account) => {
    if (!shopId || saving) return;
    setSaving(true);
    try {
      const { error } = await supabase.functions.invoke("provision-xendit-shop", { body: {
        shopId, action: "set-active", payoutChannelCode: account.channelCode, active: !account.active,
      } });
      if (error) throw new Error(await functionError(error, "Unable to update this payout account."));
      await load(); await onChanged?.();
    } catch (error: any) { Alert.alert("Update failed", error?.message || "Unable to update this payout account."); }
    finally { setSaving(false); }
  };

  const enabled = accounts.filter((account) => account.active && account.verifiedByAdmin).length;
  const pending = accounts.filter((account) => !account.verifiedByAdmin).length;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={page === "setup" ? () => setPage("list") : onClose}>
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        {page === "setup" ? (
          <KeyboardAwareScrollView contentContainerStyle={styles.setupContent} keyboardShouldPersistTaps="handled">
            <Header eyebrow={channel.type === "wallet" ? "E-wallet receiver" : "Bank receiver"} title={`${accounts.some((item) => item.channelCode === channel.code) ? "Edit" : "Add"} ${channel.label}`} onBack={() => setPage("list")} />
            <View style={styles.setupBrand}><Logo channel={channel} /><View style={styles.flex}><Text style={styles.setupTitle}>{channel.label}</Text><Text style={styles.small}>Set the receiver account for this payment method.</Text></View></View>
            <View style={styles.readonly}><Text style={styles.eyebrow}>Payment method</Text><Text style={styles.readonlyValue}>{channel.label}</Text></View>
            <Text style={styles.inputLabel}>Registered account holder</Text>
            <TextInput style={styles.input} value={draft.name} onChangeText={(name) => setDraft((current) => ({ ...current, name }))} placeholder={channel.type === "wallet" ? "Name registered to the wallet" : "Name registered to the bank account"} placeholderTextColor="#9aa5b3" maxLength={120} autoCapitalize="words" />
            <Text style={styles.inputLabel}>{channel.type === "wallet" ? "Registered mobile number" : "Bank account number"}</Text>
            <TextInput style={styles.input} value={draft.number} onChangeText={(number) => setDraft((current) => ({ ...current, number }))} placeholder={channel.type === "wallet" ? "09XXXXXXXXX" : "Enter account number"} placeholderTextColor="#9aa5b3" keyboardType="number-pad" maxLength={30} />
            <Text style={styles.help}>Enter the exact details registered with {channel.label}.</Text>
            <Notice icon="shield-checkmark-outline" title="Verification required" text="Customers cannot use this method until an administrator verifies the receiver details." />
            <View style={styles.actions}><TouchableOpacity style={styles.secondary} onPress={() => setPage("list")} disabled={saving}><Text style={styles.secondaryText}>Cancel</Text></TouchableOpacity><TouchableOpacity style={[styles.primary, saving && styles.dim]} onPress={() => void save()} disabled={saving}>{saving && <ActivityIndicator size="small" color="#fff" />}<Text style={styles.primaryText}>{saving ? "Saving..." : "Submit for verification"}</Text></TouchableOpacity></View>
          </KeyboardAwareScrollView>
        ) : (
          <><Header eyebrow="Finance" title="Payout accounts" onBack={onClose} />
            {loading ? <View style={styles.loading}><ActivityIndicator size="small" color="#24374f" /><Text style={styles.small}>Loading payout accounts...</Text></View> : (
              <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                <Text style={styles.description}>{"Choose where each customer payment method sends your shop's 70% share."}</Text>
                <View style={styles.summary}><Summary label="Set up" value={accounts.length} /><Summary label="Available" value={enabled} /><Summary label="In review" value={pending} last /></View>
                <Notice icon="wallet-outline" title="Customer methods follow your setup" text="A method only appears at customer checkout when its receiver account is active and verified." />
                {!shopApproved && <Notice warning icon="information-circle-outline" title="Available after shop approval" text="Your funeral shop must be approved before you can submit receiver accounts." />}
                {accounts.length > 0 && <AccountSection accounts={accounts} saving={saving} onEdit={openSetup} onToggle={toggle} />}
                <View style={styles.section}><Text style={styles.eyebrow}>Payment methods</Text><Text style={styles.sectionTitle}>Add or manage a receiver</Text><Text style={styles.small}>Each option opens its own setup page.</Text>
                  {(["wallet", "bank"] as const).map((type) => <View style={styles.group} key={type}><Text style={styles.groupTitle}>{type === "wallet" ? "E-wallets" : "Philippine banks"}</Text>{CHANNELS.filter((item) => item.type === type).map((item) => {
                    const account = accounts.find((entry) => entry.channelCode === item.code); const ready = Boolean(account?.active && account.verifiedByAdmin);
                    return <TouchableOpacity key={item.code} style={[styles.method, !shopApproved && styles.dim]} disabled={!shopApproved} onPress={() => openSetup(item)}><Logo channel={item} small /><View style={styles.flex}><Text style={styles.methodName}>{account ? item.label : `Add ${item.label}`}</Text><Text style={styles.methodDetail}>{account ? `${account.accountName} · ${mask(account.accountNumber)}` : item.type === "wallet" ? "Set up an e-wallet receiver" : "Set up a bank receiver account"}</Text></View><Text style={[styles.methodState, ready && styles.readyText, account && !ready && styles.pendingText]}>{ready ? "Ready" : account ? "Manage" : "Add"}</Text><Ionicons name="chevron-forward" size={18} color="#93a0af" /></TouchableOpacity>;
                  })}</View>)}
                </View>
              </ScrollView>
            )}
          </>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function Header({ eyebrow, title, onBack }: { eyebrow: string; title: string; onBack: () => void }) { return <View style={styles.header}><TouchableOpacity style={styles.back} onPress={onBack}><Ionicons name="arrow-back" size={21} color="#24374f" /></TouchableOpacity><View style={styles.flex}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.headerTitle}>{title}</Text></View></View>; }
function Logo({ channel, small }: { channel: Channel; small?: boolean }) { return <View style={[styles.logo, small && styles.logoSmall, channel.type === "wallet" ? styles.wallet : styles.bank]}><Text style={styles.logoText}>{initials(channel)}</Text></View>; }
function Summary({ label, value, last }: { label: string; value: number; last?: boolean }) { return <View style={[styles.summaryItem, last && styles.noBorder]}><Text style={styles.eyebrow}>{label}</Text><Text style={styles.summaryValue}>{value}</Text></View>; }
function Notice({ icon, title, text, warning }: { icon: keyof typeof Ionicons.glyphMap; title: string; text: string; warning?: boolean }) { return <View style={[styles.notice, warning && styles.noticeWarning]}><Ionicons name={icon} size={21} color={warning ? "#8a5b18" : "#49627f"} /><View style={styles.flex}><Text style={[styles.noticeTitle, warning && styles.warningText]}>{title}</Text><Text style={[styles.noticeText, warning && styles.warningText]}>{text}</Text></View></View>; }

function AccountSection({ accounts, saving, onEdit, onToggle }: { accounts: Account[]; saving: boolean; onEdit: (channel: Channel) => void; onToggle: (account: Account) => void }) {
  return <View style={styles.section}><Text style={styles.eyebrow}>Receiver accounts</Text><Text style={styles.sectionTitle}>Configured payment methods</Text><View style={styles.accountList}>{accounts.map((account) => {
    const channel = CHANNELS.find((item) => item.code === account.channelCode); if (!channel) return null;
    const ready = account.active && account.verifiedByAdmin; const date = verifiedDate(account.verifiedAt);
    return <View style={[styles.account, !account.active && styles.dim]} key={account.id}><Logo channel={channel} /><View style={styles.flex}><Text style={styles.accountType}>{channel.type === "wallet" ? "E-wallet" : "Philippine bank"}</Text><Text style={styles.accountName}>{channel.label}</Text><Text style={styles.methodDetail}>{account.accountName} · {mask(account.accountNumber)}</Text><View style={[styles.pill, ready ? styles.readyPill : account.verifiedByAdmin ? styles.disabledPill : styles.pendingPill]}><Text style={[styles.pillText, ready ? styles.readyText : account.verifiedByAdmin ? styles.disabledText : styles.pendingText]}>{ready ? "Available to customers" : account.verifiedByAdmin ? "Disabled" : "Awaiting verification"}</Text></View>{date && <Text style={styles.date}>Verified {date}</Text>}</View><View style={styles.accountActions}><TouchableOpacity disabled={saving} onPress={() => onEdit(channel)}><Text style={styles.actionText}>Edit</Text></TouchableOpacity><TouchableOpacity disabled={saving} onPress={() => void onToggle(account)}><Text style={styles.actionText}>{account.active ? "Disable" : "Enable"}</Text></TouchableOpacity></View></View>;
  })}</View></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f4f6f8" },
  flex: { flex: 1, minWidth: 0 },
  header: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#dce3e9", backgroundColor: "#fff" },
  back: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#f1f5f9" },
  eyebrow: { color: "#7b8798", fontSize: 9, fontWeight: "800", letterSpacing: .7, textTransform: "uppercase" },
  headerTitle: { color: "#172033", fontSize: 20, fontWeight: "900", marginTop: 2 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  content: { padding: 16, paddingBottom: 42 },
  description: { color: "#68768a", fontSize: 12, lineHeight: 18, marginBottom: 14 },
  small: { color: "#7b8798", fontSize: 10, lineHeight: 15, marginTop: 3 },
  summary: { flexDirection: "row", overflow: "hidden", borderWidth: 1, borderColor: "#dfe5eb", borderRadius: 14, backgroundColor: "#fff" },
  summaryItem: { flex: 1, alignItems: "center", paddingVertical: 14, paddingHorizontal: 6, borderRightWidth: 1, borderRightColor: "#edf1f4" },
  noBorder: { borderRightWidth: 0 },
  summaryValue: { color: "#172033", fontSize: 22, fontWeight: "900", marginTop: 4 },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 12, padding: 13, borderWidth: 1, borderColor: "#d7e1ea", borderRadius: 14, backgroundColor: "#f7fafc" },
  noticeWarning: { borderColor: "#ead8b2", backgroundColor: "#fffaf0" },
  noticeTitle: { color: "#30445e", fontSize: 12, fontWeight: "800" },
  noticeText: { color: "#6f7f92", fontSize: 10, lineHeight: 15, marginTop: 3 },
  warningText: { color: "#805a16" },
  section: { marginTop: 20, padding: 15, borderWidth: 1, borderColor: "#dfe5eb", borderRadius: 15, backgroundColor: "#fff" },
  sectionTitle: { color: "#253247", fontSize: 16, fontWeight: "900", marginTop: 3 },
  group: { marginTop: 17 },
  groupTitle: { color: "#68768a", fontSize: 10, fontWeight: "800", marginBottom: 4 },
  method: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#edf1f4" },
  logo: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  logoSmall: { width: 38, height: 38, borderRadius: 11 },
  wallet: { backgroundColor: "#e9f7f2" },
  bank: { backgroundColor: "#edf2f8" },
  logoText: { color: "#36536e", fontSize: 10, fontWeight: "900" },
  methodName: { color: "#2d3a4d", fontSize: 12, fontWeight: "800" },
  methodDetail: { color: "#8490a0", fontSize: 9, lineHeight: 13, marginTop: 3 },
  methodState: { color: "#526175", fontSize: 9, fontWeight: "800" },
  readyText: { color: "#25623e" },
  pendingText: { color: "#805a16" },
  disabledText: { color: "#64748b" },
  dim: { opacity: .48 },
  accountList: { gap: 2, marginTop: 13 },
  account: { flexDirection: "row", alignItems: "flex-start", gap: 11, paddingVertical: 12, borderTopWidth: 1, borderTopColor: "#edf1f4" },
  accountType: { color: "#8a95a4", fontSize: 8, fontWeight: "800", textTransform: "uppercase" },
  accountName: { color: "#253247", fontSize: 13, fontWeight: "800", marginTop: 2 },
  pill: { alignSelf: "flex-start", marginTop: 7, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  readyPill: { backgroundColor: "#edf8f1" },
  pendingPill: { backgroundColor: "#fff7e8" },
  disabledPill: { backgroundColor: "#f1f5f9" },
  pillText: { fontSize: 9, fontWeight: "800" },
  date: { color: "#8793a2", fontSize: 9, marginTop: 4 },
  accountActions: { alignItems: "flex-end", gap: 12, paddingTop: 2 },
  actionText: { color: "#385273", fontSize: 10, fontWeight: "800" },
  setupContent: { flexGrow: 1, paddingBottom: 34, backgroundColor: "#f4f6f8" },
  setupBrand: { flexDirection: "row", alignItems: "center", gap: 12, margin: 16, marginBottom: 4, padding: 15, borderWidth: 1, borderColor: "#dfe5eb", borderRadius: 15, backgroundColor: "#fff" },
  setupTitle: { color: "#253247", fontSize: 15, fontWeight: "900" },
  readonly: { marginHorizontal: 16, marginTop: 12, padding: 13, borderWidth: 1, borderColor: "#dfe5eb", borderRadius: 13, backgroundColor: "#fff" },
  readonlyValue: { color: "#253247", fontSize: 13, fontWeight: "800", marginTop: 4 },
  inputLabel: { color: "#526175", fontSize: 11, fontWeight: "800", marginHorizontal: 16, marginTop: 15, marginBottom: 6 },
  input: { minHeight: 50, marginHorizontal: 16, paddingHorizontal: 13, borderWidth: 1, borderColor: "#cfd8e1", borderRadius: 13, backgroundColor: "#fff", color: "#172033", fontSize: 14 },
  help: { color: "#7b8798", fontSize: 10, lineHeight: 15, marginHorizontal: 16, marginTop: 6 },
  actions: { flexDirection: "row", gap: 10, marginHorizontal: 16, marginTop: 6 },
  secondary: { minHeight: 50, flex: 1, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#cfd8e1", borderRadius: 13, backgroundColor: "#fff" },
  secondaryText: { color: "#526175", fontSize: 12, fontWeight: "900" },
  primary: { minHeight: 50, flex: 1.7, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 13, backgroundColor: "#172a46" },
  primaryText: { color: "#fff", fontSize: 12, fontWeight: "900" },
});
