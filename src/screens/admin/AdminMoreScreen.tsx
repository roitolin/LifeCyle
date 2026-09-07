import { ScrollView, StyleSheet, View } from "react-native";
import { Badge, Button, Card, Text } from "react-native-paper";
import { useAdminNotificationCount } from "../../hooks/useAdminNotificationCount";
import { useUnreadSupportCount } from "../../hooks/useUnreadSupportCount";
import { useResponsive } from "../../utils/responsive";
import { useAuth } from "../../context/AuthContext";

export default function AdminMoreScreen({ navigation }: any) {
  const { role } = useAuth();
  const { isDesktop } = useResponsive();
  const unreadSupportCount = useUnreadSupportCount();
  const adminNotificationCount = useAdminNotificationCount();
  const isRootAdmin = role === "super_admin" || role === "admin";
  const isFuneralAdmin = isRootAdmin || role === "funeral_admin";
  return (
    <ScrollView contentContainerStyle={[styles.container, isDesktop && styles.containerDesktop]}>
      <View style={styles.header}>
        <Text variant="headlineMedium" style={styles.title}>
          More Tools
        </Text>
        <Text style={styles.subtitle}>
          Review account, support, and security tools.
        </Text>
        <View style={styles.headerMetaRow}>
          <View style={styles.headerMetaItem}>
            <Badge style={styles.metaBadge}>{unreadSupportCount > 99 ? "99+" : unreadSupportCount}</Badge>
            <Text style={styles.metaLabel}>Support Unread</Text>
          </View>
          <View style={styles.headerMetaItem}>
            <Badge style={styles.metaBadge}>{adminNotificationCount > 99 ? "99+" : adminNotificationCount}</Badge>
            <Text style={styles.metaLabel}>All Notifications</Text>
          </View>
        </View>
      </View>

      <Card style={styles.card} mode="outlined">
        <Card.Title title="Admin Tools" />
        <Card.Content>
          <Text style={styles.cardText}>
            Open dedicated admin areas, review account access, and monitor administrator activity.
          </Text>
        </Card.Content>
        <Card.Actions style={styles.multiActions}>
          {isFuneralAdmin ? (
            <Button mode="contained-tonal" onPress={() => navigation.navigate("Funeral")}>
              Shops
            </Button>
          ) : null}
          {isFuneralAdmin ? (
            <Button mode="contained-tonal" onPress={() => navigation.navigate("Products")}>
              Products
            </Button>
          ) : null}
          {isFuneralAdmin ? (
            <Button mode="outlined" onPress={() => navigation.navigate("Orders")}>
              Service Requests
            </Button>
          ) : null}
          {isFuneralAdmin ? (
            <Button mode="contained-tonal" icon="wallet" onPress={() => navigation.navigate("Payments")}>
              Shop Payments
            </Button>
          ) : null}
          <Button mode="contained-tonal" onPress={() => navigation.navigate("Moderation")}>
            Moderation
          </Button>
          <Button mode="outlined" icon="pulse" onPress={() => navigation.navigate("ActivityLogs")}>
            Activity Logs
          </Button>
          <Button mode="outlined" icon="shield-account" onPress={() => navigation.navigate("LoginSecurity")}>
            Login &amp; Security
          </Button>
          {isRootAdmin ? (
            <Button mode="outlined" icon="image-outline" onPress={() => navigation.navigate("HomeContent")}>
              Mobile Home Feature
            </Button>
          ) : null}
          {isRootAdmin ? (
            <Button mode="outlined" icon="trash-can-outline" onPress={() => navigation.navigate("Deletions")}>
              Account Deletions
            </Button>
          ) : null}
          <Button mode="text" onPress={() => navigation.navigate("Notifications")}>
            Notifications
          </Button>
          <Button mode="outlined" onPress={() => navigation.navigate("Support")}>
            Support Inbox
          </Button>
          <Button mode="outlined" onPress={() => navigation.navigate("Feedback")}>
            Rate & Feedback
          </Button>
        </Card.Actions>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: "#f5f5f5",
    gap: 12,
  },
  containerDesktop: {
    maxWidth: 860,
    width: "100%",
    alignSelf: "center",
  },
  header: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#fecaca",
    backgroundColor: "#fff5f5",
    padding: 14,
  },
  title: {
    color: "#991b1b",
    fontWeight: "800",
  },
  subtitle: {
    marginTop: 4,
    color: "#4b5563",
    lineHeight: 20,
  },
  headerMetaRow: {
    marginTop: 10,
    flexDirection: "row",
    gap: 12,
    flexWrap: "wrap",
  },
  headerMetaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  metaBadge: {
    backgroundColor: "#b91c1c",
  },
  metaLabel: {
    color: "#4b5563",
    fontWeight: "700",
    fontSize: 12,
  },
  card: {
    borderRadius: 12,
    backgroundColor: "#fff",
  },
  cardText: {
    color: "#4b5563",
    lineHeight: 20,
  },
  multiActions: {
    flexWrap: "wrap",
    gap: 8,
  },
});
