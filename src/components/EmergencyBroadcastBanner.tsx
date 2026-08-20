import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Card, Text } from "react-native-paper";
import { collection, onSnapshot, query, where } from "@/services/supabaseDbCompat";
import { db } from "../services/supabaseAuth";

type BroadcastRecord = {
  id: string;
  message?: string;
  urgency?: "Critical" | "Urgent" | "Normal";
  status?: "active" | "resolved";
  targetCity?: string | null;
  createdByName?: string | null;
  createdAt?: any;
  expiresAt?: any;
};

type Props = {
  viewerCity?: string;
  limit?: number;
  title?: string;
};

const normalize = (value: string | null | undefined) => String(value || "").trim().toLowerCase();

const toDate = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getUrgencyColor = (urgency: string | undefined) => {
  switch (urgency) {
    case "Critical":
      return "#b91c1c";
    case "Urgent":
      return "#c2410c";
    default:
      return "#1d4ed8";
  }
};

const getUrgencyBg = (urgency: string | undefined) => {
  switch (urgency) {
    case "Critical":
      return "#fef2f2";
    case "Urgent":
      return "#fff7ed";
    default:
      return "#eff6ff";
  }
};

const timeLeftLabel = (expiresAt: any) => {
  const expiryDate = toDate(expiresAt);
  if (!expiryDate) return "No expiry";
  const remainingMs = expiryDate.getTime() - Date.now();
  if (remainingMs <= 0) return "Expired";
  const minutes = Math.floor(remainingMs / 60000);
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) return remMinutes === 0 ? `${hours}h left` : `${hours}h ${remMinutes}m left`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours === 0 ? `${days}d left` : `${days}d ${remHours}h left`;
};

export default function EmergencyBroadcastBanner({
  viewerCity = "",
  limit = 2,
  title = "Emergency Broadcasts",
}: Props) {
  const [broadcasts, setBroadcasts] = useState<BroadcastRecord[]>([]);

  useEffect(() => {
    const q = query(collection(db, "emergency_broadcasts"), where("status", "==", "active"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const now = new Date();
      const list = snapshot.docs
        .map((item: any) => ({ id: item.id, ...(item.data() as any) }) as BroadcastRecord)
        .filter((item: any) => {
          const expiresAt = toDate(item.expiresAt);
          if (expiresAt && expiresAt.getTime() <= now.getTime()) return false;
          const cityTarget = normalize(item.targetCity || "");
          if (cityTarget && cityTarget !== normalize(viewerCity)) return false;
          return true;
        })
        .sort((a: any, b: any) => {
          const aDate = toDate(a.createdAt)?.getTime() || 0;
          const bDate = toDate(b.createdAt)?.getTime() || 0;
          return bDate - aDate;
        });

      setBroadcasts(list);
    });

    return unsubscribe;
  }, [viewerCity]);

  const activeItems = useMemo(() => broadcasts.slice(0, limit), [broadcasts, limit]);

  if (activeItems.length === 0) return null;

  return (
    <Card style={styles.card} mode="elevated">
      <Card.Content>
        <View style={styles.headRow}>
          <Text style={styles.title}>{title}</Text>
          <View style={styles.livePill}>
            <Text style={styles.livePillText}>Live: {activeItems.length}</Text>
          </View>
        </View>
        <Text style={styles.subtitle}>Priority alerts relevant to your location.</Text>
        {activeItems.map((item: any) => {
          const urgencyColor = getUrgencyColor(item.urgency);
          const urgencyBg = getUrgencyBg(item.urgency);
          const expiresAt = toDate(item.expiresAt);
          return (
            <View key={item.id} style={styles.row}>
              <View style={styles.rowContent}>
                <View style={styles.rowHead}>
                  <Text style={[styles.urgency, { color: urgencyColor, backgroundColor: urgencyBg, borderColor: urgencyColor }]}>
                    {item.urgency || "Emergency"}
                  </Text>
                  <Text style={styles.timePill}>{timeLeftLabel(item.expiresAt)}</Text>
                </View>
                <Text style={styles.message}>{item.message || "Emergency alert posted."}</Text>
                <View style={styles.metaRow}>
                  <Text style={styles.metaPill}>{item.targetCity ? `City: ${item.targetCity}` : "Coverage: Nationwide"}</Text>
                  {expiresAt ? <Text style={styles.metaPill}>Until {expiresAt.toLocaleString(undefined, { hour12: true })}</Text> : null}
                </View>
              </View>
            </View>
          );
        })}
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    backgroundColor: "#fff8f0",
    borderWidth: 1,
    borderColor: "#f7d2bf",
  },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 2,
  },
  title: {
    color: "#9a3412",
    fontWeight: "800",
    fontSize: 16,
  },
  livePill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#fecaca",
    backgroundColor: "#fff1f2",
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  livePillText: {
    color: "#9f1239",
    fontWeight: "800",
    fontSize: 11,
  },
  subtitle: {
    color: "#7c2d12",
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 10,
  },
  row: {
    borderWidth: 1,
    borderColor: "#f5d5c3",
    borderRadius: 12,
    backgroundColor: "#fffdfb",
    padding: 10,
    marginBottom: 10,
  },
  rowContent: {
    flex: 1,
  },
  rowHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 6,
  },
  urgency: {
    fontWeight: "800",
    borderWidth: 1,
    borderRadius: 999,
    fontSize: 11,
    paddingVertical: 3,
    paddingHorizontal: 9,
    textTransform: "uppercase",
  },
  timePill: {
    color: "#92400e",
    fontSize: 11,
    fontWeight: "700",
    borderWidth: 1,
    borderColor: "#fde68a",
    backgroundColor: "#fffbeb",
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  message: {
    color: "#1f2937",
    lineHeight: 21,
    fontWeight: "600",
  },
  metaRow: {
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  metaPill: {
    color: "#7c2d12",
    fontSize: 11,
    fontWeight: "700",
    borderWidth: 1,
    borderColor: "#f1d4c4",
    backgroundColor: "#fff7f1",
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
});

