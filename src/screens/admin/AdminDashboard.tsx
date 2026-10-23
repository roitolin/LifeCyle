import { useCallback, useEffect, useState } from "react";
import LoadingBird from '@/components/LoadingBird';
import { RefreshControl, ScrollView, View, Text, StyleSheet } from "react-native";
import { Button, Card } from "react-native-paper";
import { supabase } from "@/services/supabaseClient";
import { useAuth } from "../../context/AuthContext";
import { useResponsive } from "../../utils/responsive";
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
  const { role } = useAuth();
  const { isDesktop } = useResponsive();
  const [metrics, setMetrics] = useState<DashboardMetrics>(EMPTY_METRICS);
  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const [sales, setSales] = useState<SalesOverview | null>(null);
  const [loadingSales, setLoadingSales] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const isRootAdmin = role === "super_admin" || role === "admin";
  const isFuneralAdmin = isRootAdmin || role === "funeral_admin";
  const canSeeCommsAndInsights = isRootAdmin || isFuneralAdmin;
  const canSeeSales = isSalesVisible(role);
  const title = role === "funeral_admin" ? "Funeral Admin" : "Admin Dashboard";
  const subtitle =
    role === "funeral_admin"
      ? "Monitor funeral shop approvals, users, and support tools."
      : "Monitor funeral shop approvals, users, and support channels.";

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
    const task = setTimeout(() => {
      void loadMetrics();
    }, 0);
    return () => clearTimeout(task);
  }, [loadMetrics]);

  useEffect(() => {
    const task = setTimeout(() => {
      void loadSales();
    }, 0);
    return () => clearTimeout(task);
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
        <Button mode="outlined" icon="refresh" onPress={handleDoubleTapRefresh} textColor={colors.primary} compact>
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
              <Card.Title title="Revenue - Last 6 Months" />
              <Card.Content>
                <SimpleBarChart
                  data={sales.monthlyRevenue}
                  formatValue={formatCompactPeso}
                  showValues
                  barColor={colors.primary}
                />
              </Card.Content>
            </Card>

            <Card style={styles.actionCard} mode="outlined">
              <Card.Title title="Confirmed Sales - Last 6 Months" />
              <Card.Content>
                <SimpleBarChart
                  data={sales.monthlySales}
                  showValues
                  barColor={colors.info}
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
          <Card.Actions style={styles.cardActions}>
            <Button mode="contained-tonal" buttonColor={colors.surfaceMuted} textColor={colors.primaryDark} onPress={() => navigation.navigate("Funeral")}>
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
          <Card.Actions style={styles.cardActions}>
            <Button mode="contained-tonal" buttonColor={colors.surfaceMuted} textColor={colors.primaryDark} onPress={() => navigation.navigate("Products")}>
              Products
            </Button>
            <Button mode="outlined" textColor={colors.primary} onPress={() => navigation.navigate("Orders")}>
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
        <Card.Actions style={styles.cardActions}>
          <Button mode="contained-tonal" buttonColor={colors.surfaceMuted} textColor={colors.primaryDark} onPress={() => navigation.navigate("Users")}>
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
          <Card.Actions style={styles.cardActions}>
            <Button mode="outlined" textColor={colors.primary} onPress={() => navigation.navigate("Feedback")}>
              Open Feedback Board
            </Button>
          </Card.Actions>
        </Card>
      ) : null}

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
  title: { fontSize: 30, fontWeight: "800", marginTop: 4, color: colors.primaryDark },
  subtitle: { fontSize: 14, color: colors.textMuted, marginBottom: 6, lineHeight: 20 },
  loadingWrap: {
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  loadingText: {
    color: colors.textMuted,
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
  metricValue: { fontSize: 24, fontWeight: "800", color: colors.primary },
  metricDesc: { fontSize: 12, color: colors.textMuted, marginTop: 4, lineHeight: 17 },
  sectionHeader: {
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.primaryDark,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
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
    color: colors.text,
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
    color: colors.primaryDark,
  },
  actionCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardActions: {
    flexWrap: "wrap",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  cardText: {
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 21,
  },
  containerDesktop: { maxWidth: 700, alignSelf: "center", width: "100%" },
});
