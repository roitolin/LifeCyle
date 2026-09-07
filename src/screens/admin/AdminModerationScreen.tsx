import { useEffect, useState } from "react";
import { Alert, FlatList, Image, Linking, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Button, Card, SegmentedButtons, Text } from "react-native-paper";
import { supabase } from "@/services/supabaseClient";
import { auth } from "../../services/supabaseAuth";
import { useResponsive } from "../../utils/responsive";
import { buildRiskProfiles, RiskProfile } from "../../utils/riskScoring";
import { logAdminAction } from "../../utils/adminAuditLog";

type ModerationMode = "reports" | "blocks" | "risk";

type AbuseReport = {
  id: string;
  reporterId: string;
  targetUserId: string;
  reporterName?: string | null;
  targetName?: string | null;
  requestId?: string | null;
  conversationId?: string | null;
  reason: string;
  details?: string;
  evidenceURL?: string | null;
  source?: string;
  status?: "open" | "reviewing" | "resolved" | "dismissed";
  createdAt?: any;
};

type BlockRecord = {
  id: string;
  blockerId: string;
  blockedId: string;
  reason?: string;
  active?: boolean;
  createdAt?: any;
};

export default function AdminModerationScreen() {
  const navigation = useNavigation<any>();
  const { isDesktop } = useResponsive();
  const [mode, setMode] = useState<ModerationMode>("reports");
  const [reports, setReports] = useState<AbuseReport[]>([]);
  const [blocks, setBlocks] = useState<BlockRecord[]>([]);
  const [riskProfiles, setRiskProfiles] = useState<RiskProfile[]>([]);
  const [userLookup, setUserLookup] = useState<Record<string, { fullName?: string; email?: string; role?: string }>>({});
  const [latestServiceIdsByUser, setLatestServiceIdsByUser] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadQueue();
  }, []);

  const loadQueue = async () => {
    setLoading(true);
    try {
      const [reportsSnap, blocksSnap, serviceRequestsSnap, usersSnap] = await Promise.all([
        supabase.from("abuse_reports").select("*").order("createdAt", { ascending: false }),
        supabase.from("user_blocks").select("*").order("createdAt", { ascending: false }),
        supabase.from("funeral_service_requests").select("*"),
        supabase.from("users").select("*"),
      ]);

      if (reportsSnap.error) throw reportsSnap.error;
      if (blocksSnap.error) throw blocksSnap.error;
      if (serviceRequestsSnap.error) throw serviceRequestsSnap.error;
      if (usersSnap.error) throw usersSnap.error;

      const userMap = (usersSnap.data || []).reduce((acc: any, item: any) => {
        acc[item.id] = {
          fullName: item?.fullName || "",
          email: item?.email || "",
          role: item?.role || "user",
        };
        return acc;
      }, {} as Record<string, { fullName?: string; email?: string; role?: string }>);

      const serviceRecords = serviceRequestsSnap.data || [];
      const sortedServices = [...serviceRecords].sort((a: any, b: any) => {
        const aTime = new Date(a?.createdAt || 0).getTime();
        const bTime = new Date(b?.createdAt || 0).getTime();
        return bTime - aTime;
      });

      const serviceMap: Record<string, string[]> = {};
      sortedServices.forEach((item: any) => {
        const requesterId = String(item?.requesterId || "");
        if (!requesterId) return;
        if (!serviceMap[requesterId]) {
          serviceMap[requesterId] = [];
        }
        if (serviceMap[requesterId].length < 3) {
          serviceMap[requesterId].push(item.id);
        }
      });

      const nextReports = (reportsSnap.data || []) as AbuseReport[];
      const nextBlocks = (blocksSnap.data || []) as BlockRecord[];
      
      setUserLookup(userMap);
      setReports(nextReports);
      setBlocks(nextBlocks);
      setLatestServiceIdsByUser(serviceMap);
      setRiskProfiles(
        buildRiskProfiles({
          reports: nextReports,
          blocks: nextBlocks,
          serviceRequests: serviceRecords,
          users: usersSnap.data || [],
        })
      );
    } catch (error) {
      console.error("Failed to load moderation queue:", error);
      Alert.alert("Error", "Could not load moderation queue.");
    } finally {
      setLoading(false);
    }
  };

  const setReportStatus = async (reportId: string, status: AbuseReport["status"]) => {
    try {
      const { error } = await supabase.from("abuse_reports").update({
        status,
        updatedAt: new Date().toISOString(),
      }).eq("id", reportId);
      if (error) throw error;
      
      setReports((prev) => prev.map((item: any) => (item.id === reportId ? { ...item, status } : item)));
      await logAdminAction({
        adminId: auth.currentUser?.uid,
        action: "report_status_updated",
        targetType: "report",
        targetId: reportId,
        summary: `Updated abuse report ${reportId} to ${status}`,
      });
      await loadQueue();
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to update report.");
    }
  };

  const deactivateBlock = async (blockId: string) => {
    try {
      const { error } = await supabase.from("user_blocks").update({
        active: false,
        updatedAt: new Date().toISOString(),
      }).eq("id", blockId);
      if (error) throw error;
      
      setBlocks((prev) => prev.map((item: any) => (item.id === blockId ? { ...item, active: false } : item)));
      await logAdminAction({
        adminId: auth.currentUser?.uid,
        action: "block_deactivated",
        targetType: "block",
        targetId: blockId,
        summary: `Deactivated block record ${blockId}`,
      });
      await loadQueue();
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to update block.");
    }
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return "Unknown";
    const date = new Date(timestamp);
    return isNaN(date.getTime()) ? "Unknown" : date.toLocaleString(undefined, { hour12: true });
  };

  const renderReport = ({ item }: { item: AbuseReport }) => (
    <Card style={styles.card} mode="outlined">
      <Card.Content>
        <View style={styles.rowBetween}>
          <Text style={styles.title}>Reason: {item.reason}</Text>
          <Text style={styles.status}>{(item.status || "open").toUpperCase()}</Text>
        </View>
        <Text style={styles.meta}>
          Reporter: {item.reporterName || userLookup[item.reporterId]?.fullName || userLookup[item.reporterId]?.email || "Unknown"}
        </Text>
        <Text style={styles.meta}>Reporter UID: {item.reporterId}</Text>
        <Text style={styles.meta}>
          Target: {item.targetName || userLookup[item.targetUserId]?.fullName || userLookup[item.targetUserId]?.email || "Unknown"}
        </Text>
        <Text style={styles.meta}>Target UID: {item.targetUserId}</Text>
        {item.requestId ? <Text style={styles.meta}>Request ID: {item.requestId}</Text> : null}
        {item.conversationId ? <Text style={styles.meta}>Conversation ID: {item.conversationId}</Text> : null}
        <Text style={styles.meta}>Source: {item.source || "app"}</Text>
        {!!item.details && <Text style={styles.details}>Details: {item.details}</Text>}
        {item.evidenceURL ? (
          <View style={styles.evidenceWrap}>
            <Image source={{ uri: item.evidenceURL }} style={styles.evidenceImage} />
            <Button mode="outlined" compact onPress={() => Linking.openURL(item.evidenceURL || "")}>
              Open Full Evidence
            </Button>
          </View>
        ) : null}
        <Text style={styles.time}>
          Filed: {formatDate(item.createdAt)}
        </Text>
      </Card.Content>
      <Card.Actions>
        <Button mode="text" onPress={() => navigation.navigate("AdminUserDetail", { userId: item.reporterId })}>Reporter</Button>
        <Button mode="text" onPress={() => navigation.navigate("AdminUserDetail", { userId: item.targetUserId })}>Target</Button>
        <Button mode="text" onPress={() => setReportStatus(item.id, "reviewing")}>Reviewing</Button>
        <Button mode="text" onPress={() => setReportStatus(item.id, "resolved")}>Resolve</Button>
        <Button mode="text" onPress={() => setReportStatus(item.id, "dismissed")}>Dismiss</Button>
      </Card.Actions>
    </Card>
  );

  const renderBlock = ({ item }: { item: BlockRecord }) => (
    <Card style={styles.card} mode="outlined">
      <Card.Content>
        <View style={styles.rowBetween}>
          <Text style={styles.title}>Block Record</Text>
          <Text style={[styles.status, !item.active && styles.statusMuted]}>
            {item.active === false ? "INACTIVE" : "ACTIVE"}
          </Text>
        </View>
        <Text style={styles.meta}>Blocker: {item.blockerId}</Text>
        <Text style={styles.meta}>Blocked: {item.blockedId}</Text>
        <Text style={styles.meta}>Reason: {item.reason || "safety"}</Text>
        <Text style={styles.time}>
          Created: {formatDate(item.createdAt)}
        </Text>
      </Card.Content>
      <Card.Actions>
        <Button mode="text" disabled={item.active === false} onPress={() => deactivateBlock(item.id)}>
          Deactivate
        </Button>
      </Card.Actions>
    </Card>
  );

  const reportsOpenCount = reports.filter((item: any) => (item.status || "open") === "open").length;
  const activeBlocksCount = blocks.filter((item: any) => item.active !== false).length;
  const highRiskCount = riskProfiles.filter((item: any) => item.level === "high").length;

  const renderRiskItem = ({ item }: { item: RiskProfile }) => (
    <Card style={styles.card} mode="outlined">
      <Card.Content>
        <View style={styles.rowBetween}>
          <Text style={styles.title}>User: {item.userId}</Text>
          <Text style={[styles.status, item.level === "high" && styles.riskHigh, item.level === "medium" && styles.riskMedium]}>
            {item.level.toUpperCase()} ({item.score})
          </Text>
        </View>
        <Text style={styles.meta}>Open Reports: {item.openReports}</Text>
        <Text style={styles.meta}>Active Blocks (as target): {item.activeBlocksAsTarget}</Text>
        <Text style={styles.meta}>Active Blocks (as blocker): {item.activeBlocksAsBlocker}</Text>
        <Text style={styles.meta}>Suspicious Service Records: {item.suspiciousRequests}</Text>
        {item.reasons.length > 0 ? (
          <Text style={styles.details}>Signals: {item.reasons.join(" | ")}</Text>
        ) : (
          <Text style={styles.details}>Signals: none</Text>
        )}
        <View style={styles.riskActionRow}>
          <Button mode="outlined" compact onPress={() => navigation.navigate("AdminUserDetail", { userId: item.userId })}>
            User Details
          </Button>
          {!!latestServiceIdsByUser[item.userId]?.[0] ? <Text style={styles.meta}>Latest service ID: {latestServiceIdsByUser[item.userId][0]}</Text> : null}
        </View>
        {latestServiceIdsByUser[item.userId]?.length > 1 && (
          <View style={styles.riskRequestLinks}>
            {latestServiceIdsByUser[item.userId].slice(0, 3).map((serviceId) => (
              <Text key={serviceId} style={styles.meta}>{`Service #${serviceId.slice(0, 6)}`}</Text>
            ))}
          </View>
        )}
      </Card.Content>
    </Card>
  );

  return (
    <View style={[styles.container, isDesktop && styles.containerDesktop]}>
      <Card style={styles.headerCard} mode="outlined">
        <Card.Content>
          <Text style={styles.headerTitle}>Moderation Queue</Text>
          <Text style={styles.headerSubtitle}>
            Manage abuse reports and block records to reduce spam and unsafe behavior. Reports from Report Center appear here.
          </Text>
          <View style={styles.kpiRow}>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiValue}>{reportsOpenCount}</Text>
              <Text style={styles.kpiLabel}>Open Reports</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiValue}>{activeBlocksCount}</Text>
              <Text style={styles.kpiLabel}>Active Blocks</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiValue}>{highRiskCount}</Text>
              <Text style={styles.kpiLabel}>High Risk Users</Text>
            </View>
          </View>
        </Card.Content>
      </Card>

      <SegmentedButtons
        value={mode}
        onValueChange={(value) => setMode(value as ModerationMode)}
        buttons={[
          { value: "reports", label: "Reports" },
          { value: "blocks", label: "Blocks" },
          { value: "risk", label: "Risk Scoring" },
        ]}
        style={styles.segmented}
      />

      {mode === "reports" ? (
        <FlatList
          data={reports}
          keyExtractor={(item) => item.id}
          renderItem={renderReport}
          refreshing={loading}
          onRefresh={loadQueue}
          ListEmptyComponent={
            !loading ? (
              <Text style={styles.empty}>No records in this moderation queue.</Text>
            ) : null
          }
          contentContainerStyle={styles.listContent}
        />
      ) : mode === "blocks" ? (
        <FlatList
          data={blocks}
          keyExtractor={(item) => item.id}
          renderItem={renderBlock}
          refreshing={loading}
          onRefresh={loadQueue}
          ListEmptyComponent={
            !loading ? (
              <Text style={styles.empty}>No records in this moderation queue.</Text>
            ) : null
          }
          contentContainerStyle={styles.listContent}
        />
      ) : (
        <FlatList
          data={riskProfiles}
          keyExtractor={(item) => item.userId}
          renderItem={renderRiskItem}
          refreshing={loading}
          onRefresh={loadQueue}
          ListEmptyComponent={
            !loading ? (
              <Text style={styles.empty}>No risk signals found yet.</Text>
            ) : null
          }
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    padding: 16,
  },
  containerDesktop: {
    maxWidth: 980,
    alignSelf: "center",
    width: "100%",
  },
  headerCard: {
    borderRadius: 12,
    marginBottom: 10,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#b91c1c",
  },
  headerSubtitle: {
    marginTop: 4,
    color: "#4b5563",
  },
  kpiRow: {
    marginTop: 10,
    flexDirection: "row",
    gap: 8,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    padding: 10,
  },
  kpiValue: {
    fontSize: 22,
    fontWeight: "800",
    color: "#b91c1c",
  },
  kpiLabel: {
    color: "#6b7280",
    fontWeight: "600",
    fontSize: 12,
  },
  segmented: {
    marginBottom: 10,
  },
  listContent: {
    paddingBottom: 24,
    flexGrow: 1,
  },
  card: {
    borderRadius: 12,
    marginBottom: 10,
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 4,
  },
  title: {
    fontWeight: "800",
    color: "#111827",
    fontSize: 16,
  },
  status: {
    color: "#1d4ed8",
    fontWeight: "800",
    fontSize: 11,
  },
  statusMuted: {
    color: "#6b7280",
  },
  riskHigh: {
    color: "#b91c1c",
  },
  riskMedium: {
    color: "#b45309",
  },
  meta: {
    color: "#374151",
    marginTop: 2,
  },
  details: {
    marginTop: 4,
    color: "#111827",
    fontWeight: "600",
  },
  evidenceWrap: {
    marginTop: 6,
    gap: 6,
  },
  evidenceImage: {
    width: "100%",
    height: 170,
    borderRadius: 8,
    backgroundColor: "#f3f4f6",
  },
  riskActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
  },
  riskRequestLinks: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 2,
  },
  time: {
    marginTop: 6,
    color: "#6b7280",
    fontSize: 12,
  },
  empty: {
    textAlign: "center",
    color: "#6b7280",
    marginTop: 28,
  },
});
