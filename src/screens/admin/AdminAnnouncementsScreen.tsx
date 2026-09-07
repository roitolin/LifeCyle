import { useEffect, useState, useCallback } from "react";
import { Alert, FlatList, StyleSheet, View } from "react-native";
import { Button, Card, SegmentedButtons, Switch, Text, TextInput } from "react-native-paper";
import { supabase } from "@/services/supabaseClient";
import { auth } from "../../services/supabaseAuth";
import { useResponsive } from "../../utils/responsive";
import { createAnnouncement } from "../../utils/announcements";

type Announcement = {
  id: string;
  title: string;
  body: string;
  status?: "active" | "archived";
  isPinned?: boolean;
  createdAt?: string;
};

export default function AdminAnnouncementsScreen() {
  const { isDesktop } = useResponsive();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isPinned, setIsPinned] = useState(false);
  const [creating, setCreating] = useState(false);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [filter, setFilter] = useState<"active" | "archived">("active");

  const loadAnnouncements = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("announcements")
        .select("*")
        .eq("status", filter)
        .order("createdAt", { ascending: false });

      if (error) throw error;
      setAnnouncements((data || []) as Announcement[]);
    } catch (error) {
      console.error("Error loading announcements:", error);
    }
  }, [filter]);

  useEffect(() => {
    loadAnnouncements();

    const channel = supabase
      .channel('public:announcements')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'announcements' },
        () => {
          loadAnnouncements();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadAnnouncements]);

  const publishAnnouncement = async () => {
    const adminId = auth.currentUser?.uid;
    if (!adminId) {
      Alert.alert("Error", "You must be logged in as admin.");
      return;
    }

    setCreating(true);
    try {
      await createAnnouncement({
        createdBy: adminId,
        title,
        body,
        isPinned,
      });
      setTitle("");
      setBody("");
      setIsPinned(false);
      Alert.alert("Published", "Announcement was sent to users and notification has been created.");
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to publish announcement.");
    } finally {
      setCreating(false);
    }
  };

  const updateAnnouncementStatus = async (announcementId: string, status: "active" | "archived") => {
    try {
      const { error } = await supabase
        .from("announcements")
        .update({ status, updatedAt: new Date().toISOString() })
        .eq("id", announcementId);
        
      if (error) throw error;
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to update announcement.");
    }
  };

  const renderItem = ({ item }: { item: Announcement }) => (
    <Card style={styles.announcementCard} mode="outlined">
      <Card.Content>
        <View style={styles.rowBetween}>
          <Text style={styles.announcementTitle}>{item.title}</Text>
          {item.isPinned ? <Text style={styles.pinnedBadge}>PINNED</Text> : null}
        </View>
        <Text style={styles.announcementBody}>{item.body}</Text>
        <Text style={styles.announcementMeta}>
          {item.createdAt ? new Date(item.createdAt).toLocaleString(undefined, { hour12: true }) : "Unknown date"}
        </Text>
      </Card.Content>
      <Card.Actions>
        {item.status === "active" ? (
          <Button mode="text" onPress={() => updateAnnouncementStatus(item.id, "archived")}>
            Archive
          </Button>
        ) : (
          <Button mode="text" onPress={() => updateAnnouncementStatus(item.id, "active")}>
            Reactivate
          </Button>
        )}
      </Card.Actions>
    </Card>
  );

  return (
    <View style={[styles.container, isDesktop && styles.containerDesktop]}>
      <Card style={styles.headerCard} mode="outlined">
        <Card.Title title="Announcements" subtitle="Post updates for all users with notifications." />
        <Card.Content>
          <TextInput
            mode="outlined"
            label="Title"
            value={title}
            onChangeText={setTitle}
            placeholder="Example: Holiday service schedule"
            style={styles.input}
          />
          <TextInput
            mode="outlined"
            label="Announcement message"
            value={body}
            onChangeText={setBody}
            multiline
            placeholder="Write details for all users..."
            style={styles.input}
          />
          <View style={styles.pinRow}>
            <Text style={styles.pinLabel}>Pin this announcement on top</Text>
            <Switch value={isPinned} onValueChange={setIsPinned} />
          </View>
          <Button mode="contained" onPress={publishAnnouncement} loading={creating} disabled={creating}>
            {creating ? "Publishing..." : "Publish Announcement"}
          </Button>
        </Card.Content>
      </Card>

      <SegmentedButtons
        value={filter}
        onValueChange={(value) => setFilter(value as "active" | "archived")}
        buttons={[
          { value: "active", label: "Active" },
          { value: "archived", label: "Archived" },
        ]}
        style={styles.segmented}
      />

      <FlatList
        data={announcements}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={<Text style={styles.empty}>No announcements found.</Text>}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: "#f5f5f5",
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
  input: {
    marginBottom: 10,
  },
  pinRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  pinLabel: {
    color: "#374151",
    fontWeight: "600",
  },
  segmented: {
    marginBottom: 10,
  },
  listContent: {
    paddingBottom: 24,
    flexGrow: 1,
  },
  announcementCard: {
    borderRadius: 12,
    marginBottom: 10,
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  announcementTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#111827",
    flex: 1,
  },
  pinnedBadge: {
    fontSize: 10,
    fontWeight: "800",
    color: "#92400e",
    backgroundColor: "#fffbeb",
    borderColor: "#fde68a",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  announcementBody: {
    color: "#374151",
    lineHeight: 20,
  },
  announcementMeta: {
    marginTop: 6,
    color: "#6b7280",
    fontSize: 12,
  },
  empty: {
    marginTop: 24,
    textAlign: "center",
    color: "#6b7280",
  },
});
