import { useCallback, useEffect, useState } from "react";
import LoadingBird from '@/components/LoadingBird';
import { RefreshControl, ScrollView, View, Text, StyleSheet } from "react-native";
import { Button, Card } from "react-native-paper";
import { supabase } from "@/services/supabaseClient";
import { useAuth } from "../../context/AuthContext";
import { useResponsive } from "../../utils/responsive";
import { useAppDialog } from "../../hooks/useAppDialog";
import { useDoubleTapAction } from "../../hooks/useDoubleTapAction";
import { SimpleBarChart } from "@/components";
import { formatPhilippinePeso } from "@/utils/funeralCatalog";
import {
  computeSalesOverview,
  formatCompactPeso,
  isSalesVisible,
  type SalesOverview,
  type SalesRequest,
} from "@/utils/salesAnalytics";
import { colors, radii, spacing } from "@/theme";

type DashboardMetrics = {
  totalUsers: number;
  pendingFuneralShops: number;
  totalProducts: number;
  totalOrders: number;
};

const EMPTY_METRICS: DashboardMetrics = {
  totalUsers: 0,
  pendingFuneralShops: 0,
  totalProducts: 0,
  totalOrders: 0,
};

function MetricTile({ value, label }: { value: string | number; label: string }) {
  return (
    <View style={styles.metricTile}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricDesc}>{label}</Text>
    </View>
  );
}

export default function AdminDashboard({ navigation }: any) {
  const { logout, role } = useAuth();
  const { isDesktop } = useResponsive();
  const [metrics, setMetrics] = useState<DashboardMetrics>(EMPTY_METRICS);
  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const [sales, setSales] = useState<SalesOverview | null>(null);
  const [loadingSales, setLoadingSales] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { showDialog, dialog } = useAppDialog();
  const isRootAdmin = role === "super_admin" || role === "admin";
  const isFuneralAdmin = isRootAdmin || role === "funeral_admin";
  const canSeeCommsAndInsights = isRootAdmin || isFuneralAdmin;
  const canSeeSales = isSalesVisible(role);
  const title = role === "funeral_admin" ? "Funeral Admin" : "Admin Dashboard";
  const subtitle =
    role === "funeral_admin"
      ? "Monitor funeral shop approvals, users, and support tools."
      : "Monitor funeral shop approvals, users, and support channels.";

  const handleLogout = () => {
    showDialog({
      title: "Log Out of Admin Panel?",
      message: "You’ll be signed out of the admin dashboard on this device.",
      tone: "warning",
      actions: [
        { label: "Cancel", mode: "text" },
        {
          label: "Log Out",
          mode: "contained",
          onPress: async () => {
            try {
              await logout();
            } catch (error: any) {
              showDialog({
                title: "Logout Failed",
                message: error?.message || "Failed to log out.",
                tone: "danger",
              });
            }
          },
        },
      ],
    });
  };

  const loadMetrics = useCallback(async () => {
    setLoadingMetrics(true);
    try {
      const [allUsersRes, pendingShopsRes, productsRes, ordersRes] = await Promise.all([
        supabase.from("users").select("*", { count: "exact", head: true }),
        supabase.from("funeral_shops").select("*", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("funeral_products").select("*", { count: "exact", head: true }),
        supabase.from("funeral_service_requests").select("*", { count: "exact", head: true }),
      ]);

      setMetrics({
        totalUsers: allUsersRes.count || 0,
        pendingFuneralShops: pendingShopsRes.count || 0,
        totalProducts: productsRes.count || 0,
        totalOrders: ordersRes.count || 0,
      });
    } catch (error) {
      console.error("Failed to load dashboard metrics:", error);
      setMetrics(EMPTY_METRICS);
    } finally {
      setLoadingMetrics(false);
    }
  }, []);

  const loadSales = useCallback(async () => {
    if (!canSeeSales) {
      setLoadingSales(false);
      return;
    }
    setLoadingSales(true);
    try {
      const { data, error } = await supabase
        .from("funeral_service_requests")
        .select("id, status, productPrice, paymentAmount, createdAt, paymentVerifiedAt, completedAt")
        .limit(5000);

      if (error) throw error;

      setSales(computeSalesOverview((data || []) as SalesRequest[]));
    } catch (error) {
      console.error("Failed to load sales overview:", error);
      setSales(null);
    } finally {
      setLoadingSales(false);
    }
  }, [canSeeSales]);

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  useEffect(() => {
    loadSales();
  }, [loadSales]);

  const refreshDashboard = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadMetrics(), loadSales()]);
    } finally {
      setRefreshing(false);
    }
  }, [loadMetrics, loadSales]);

  const handleDoubleTapRefresh = useDoubleTapAction(refreshDashboard);

  return (
    <ScrollView
      contentContainerStyle={[styles.container, isDesktop && styles.containerDesktop]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshDashboard} />}
    >
      <View style={styles.headerRow}>
        <View style={styles.headerTextWrap}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        <Button mode="outlined" icon="refresh" onPress={handleDoubleTapRefresh} compact>
          Refresh x2
        </Button>
      </View>

      {loadingMetrics ? (
        <LoadingBird compact />
      ) : (
        <View style={styles.metricsGrid}>
          <MetricTile value={metrics.totalUsers} label="Total users" />
          {isFuneralAdmin ? (
            <MetricTile value={metrics.pendingFuneralShops} label="Pending shop verifications" />
          ) : null}
          {isFuneralAdmin ? (
            <MetricTile value={metrics.totalProducts} label="Total products" />
          ) : null}
          {isFuneralAdmin ? (
            <MetricTile value={metrics.totalOrders} label="Service requests" />
          ) : null}
        </View>
      )}

      {canSeeSales && loadingSales ? <LoadingBird compact /> : null}

      {canSeeSales && !loadingSales && sales ? (
        <>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Sales Overview</Text>
            <Text style={styles.sectionSubtitle}>
              Revenue from confirmed and completed service requests.
            </Text>
          </View>

            <View style={styles.metricsGrid}>
              <MetricTile value={formatPhilippinePeso(sales.totalRevenue)} label="Total revenue" />
              <MetricTile value={formatPhilippinePeso(sales.revenueThisMonth)} label={`This month (${sales.salesThisMonth} sale${sales.salesThisMonth === 1 ? "" : "s"})`} />
              <MetricTile value={sales.totalSales} label="Confirmed sales" />
              <MetricTile value={formatPhilippinePeso(sales.avgOrderValue)} label="Average order value" />
            </View>

            <Card style={styles.actionCard} mode="outlined">
              <Card.Title title="Revenue — Last 6 Months" />
              <Card.Content>
                <SimpleBarChart
                  data={sales.monthlyRevenue}
                  formatValue={formatCompactPeso}
                  showValues
                  barColor="#d32f2f"
                />
              </Card.Content>
            </Card>

            <Card style={styles.actionCard} mode="outlined">
              <Card.Title title="Confirmed Sales — Last 6 Months" />
              <Card.Content>
                <SimpleBarChart
                  data={sales.monthlySales}
                  showValues
                  barColor="#16a34a"
                />
              </Card.Content>
            </Card>

            {sales.breakdown.length > 0 ? (
              <Card style={styles.actionCard} mode="outlined">
                <Card.Title title="Service Request Status" />
                <Card.Content>
                  {sales.breakdown.map((item) => {
                    const max = sales.breakdown.reduce((m, b) => Math.max(m, b.value), 1);
                    const ratio = item.value / max;
                    return (
                      <View key={item.label} style={styles.breakdownRow}>
                        <Text style={styles.breakdownLabel}>{item.label}</Text>
                        <View style={styles.breakdownTrack}>
                          <View
                            style={[
                              styles.breakdownFill,
                              {
                                width: `${Math.max(2, Math.round(ratio * 100))}%`,
                                backgroundColor: item.color,
                              },
                            ]}
                          />
                        </View>
                        <Text style={styles.breakdownValue}>{item.value}</Text>
                      </View>
                    );
                  })}
                </Card.Content>
              </Card>
            ) : null}
          </>
        ) : null}

      {isFuneralAdmin ? (
        <Card style={styles.actionCard} mode="outlined">
          <Card.Title title="Admin Funeral Shop Verification Queue" />
          <Card.Content>
            <Text style={styles.cardText}>
              Review funeral shop registrations, inspect business records, and approve or reject shop submissions.
            </Text>
          </Card.Content>
          <Card.Actions>
            <Button mode="contained-tonal" onPress={() => navigation.navigate("Funeral")}>
              Open Queue ({metrics.pendingFuneralShops})
            </Button>
          </Card.Actions>
        </Card>
      ) : null}

      {isFuneralAdmin ? (
        <Card style={styles.actionCard} mode="outlined">
          <Card.Title title="Shop Products & Service Requests" />
          <Card.Content>
            <Text style={styles.cardText}>
              View every product listed across all funeral shops and all submitted service requests.
            </Text>
          </Card.Content>
          <Card.Actions>
            <Button mode="contained-tonal" onPress={() => navigation.navigate("Products")}>
              Products
            </Button>
            <Button mode="outlined" onPress={() => navigation.navigate("Orders")}>
              Service Requests
            </Button>
          </Card.Actions>
        </Card>
      ) : null}

      <Card style={styles.actionCard} mode="outlined">
        <Card.Title title="User Management" />
        <Card.Content>
          <Text style={styles.cardText}>
            View user profiles and manage user records.
          </Text>
        </Card.Content>
        <Card.Actions>
          <Button mode="contained-tonal" onPress={() => navigation.navigate("Users")}>
            Manage Users
          </Button>
        </Card.Actions>
      </Card>

      {canSeeCommsAndInsights ? (
        <Card style={styles.actionCard} mode="outlined">
          <Card.Title title="Ratings & Feedback" />
          <Card.Content>
            <Text style={styles.cardText}>
              Review user ratings, reply to feedback, and react to community comments.
            </Text>
          </Card.Content>
          <Card.Actions>
            <Button mode="outlined" onPress={() => navigation.navigate("Feedback")}>
              Open Feedback Board
            </Button>
          </Card.Actions>
        </Card>
      ) : null}

      <View style={styles.logoutWrap}>
        <Button mode="contained" buttonColor="#c62828" onPress={handleLogout}>
          Logout
        </Button>
      </View>
      {dialog}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.xl,
    backgroundColor: colors.background,
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  headerTextWrap: {
    flex: 1,
  },
  title: { fontSize: 30, fontWeight: "800", marginTop: 4, color: "#d32f2f" },
  subtitle: { fontSize: 14, color: "#666", marginBottom: 6 },
  loadingWrap: {
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  loadingText: {
    color: "#4b5563",
    fontWeight: "600",
  },
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  metricTile: {
    width: "48%",
    minHeight: 92,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    justifyContent: "center",
  },
  metricValue: { fontSize: 24, fontWeight: "800", color: "#b71c1c" },
  metricDesc: { fontSize: 12, color: "#666", marginTop: 4 },
  sectionHeader: {
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#0f172a",
  },
  sectionSubtitle: {
    fontSize: 13,
    color: "#64748b",
    marginTop: 2,
  },
  breakdownRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginVertical: 4,
  },
  breakdownLabel: {
    width: 130,
    fontSize: 13,
    fontWeight: "700",
    color: "#334155",
  },
  breakdownTrack: {
    flex: 1,
    height: 12,
    borderRadius: 999,
    backgroundColor: "#eef1ec",
    overflow: "hidden",
  },
  breakdownFill: {
    height: "100%",
    borderRadius: 999,
  },
  breakdownValue: {
    width: 34,
    textAlign: "right",
    fontSize: 13,
    fontWeight: "800",
    color: "#0f172a",
  },
  actionCard: {
    borderRadius: 12,
    backgroundColor: "#fff",
  },
  cardText: {
    fontSize: 14,
    color: "#555",
    lineHeight: 21,
  },
  logoutWrap: {
    marginTop: 8,
    marginBottom: 10,
  },
  containerDesktop: { maxWidth: 700, alignSelf: "center", width: "100%" },
});
