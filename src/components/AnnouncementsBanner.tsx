import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Card, Text } from "react-native-paper";
import { collection, onSnapshot, query, where } from "@/services/supabaseDbCompat";
import { db } from "../services/supabaseAuth";

type Announcement = {
  id: string;
  title?: string;
  body?: string;
  isPinned?: boolean;
  createdAt?: any;
};

type Props = {
  limit?: number;
};

export default function AnnouncementsBanner({ limit = 3 }: Props) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  useEffect(() => {
    const q = query(collection(db, "announcements"), where("status", "==", "active"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs
        .map((item: any) => ({ id: item.id, ...(item.data() as any) }) as Announcement)
        .sort((a: any, b: any) => {
          const pinnedA = a.isPinned ? 1 : 0;
          const pinnedB = b.isPinned ? 1 : 0;
          if (pinnedA !== pinnedB) return pinnedB - pinnedA;
          const aTime = a.createdAt?.toDate?.()?.getTime?.() || 0;
          const bTime = b.createdAt?.toDate?.()?.getTime?.() || 0;
          return bTime - aTime;
        });
      setAnnouncements(list);
    });
    return unsubscribe;
  }, []);

  const visibleItems = useMemo(() => announcements.slice(0, limit), [announcements, limit]);
  if (visibleItems.length === 0) return null;

  return (
    <Card style={styles.card} mode="elevated">
      <Card.Content>
        <Text style={styles.title}>Announcements</Text>
        {visibleItems.map((item: any) => (
          <View key={item.id} style={styles.item}>
            <View style={styles.row}>
              <Text style={styles.itemTitle}>{item.title || "Update"}</Text>
              {item.isPinned ? <Text style={styles.pinned}>PINNED</Text> : null}
            </View>
            <Text style={styles.itemBody}>{item.body || ""}</Text>
            <Text style={styles.itemTime}>
              {item.createdAt?.toDate ? item.createdAt.toDate().toLocaleString(undefined, { hour12: true }) : "Unknown date"}
            </Text>
          </View>
        ))}
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#fecaca",
    backgroundColor: "#fff1f2",
  },
  title: {
    fontWeight: "800",
    color: "#9f1239",
    marginBottom: 8,
    fontSize: 16,
  },
  item: {
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#fecdd3",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  itemTitle: {
    flex: 1,
    color: "#831843",
    fontWeight: "800",
  },
  pinned: {
    color: "#9a3412",
    fontSize: 10,
    fontWeight: "800",
    borderWidth: 1,
    borderColor: "#fdba74",
    borderRadius: 999,
    backgroundColor: "#ffedd5",
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  itemBody: {
    marginTop: 2,
    color: "#7f1d1d",
    lineHeight: 19,
  },
  itemTime: {
    marginTop: 4,
    color: "#6b7280",
    fontSize: 12,
    fontWeight: "600",
  },
});

