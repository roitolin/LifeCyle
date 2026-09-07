export type SalesRequest = {
  id: string;
  status?: string | null;
  productPrice?: string | number | null;
  paymentAmount?: string | number | null;
  createdAt?: string | null;
  paymentVerifiedAt?: string | null;
  completedAt?: string | null;
  acceptedAt?: string | null;
  declinedAt?: string | null;
  cancelledAt?: string | null;
  shopName?: string | null;
};

export type SalesBreakdown = {
  label: string;
  value: number;
  color: string;
};

export type SalesOverview = ReturnType<typeof computeSalesOverview>;

const PAID_STATUSES = new Set([
  "payment_verified",
  "completed",
]);

const toDate = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const monthKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}`;

const monthLabel = (key: string) => {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month, 1).toLocaleString("en-US", { month: "short" });
};

const moneyOf = (request: SalesRequest): number => {
  const raw = request.paymentAmount ?? request.productPrice ?? 0;
  const numeric = Number(raw);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
};

const isPaid = (request: SalesRequest) =>
  PAID_STATUSES.has(String(request.status || "").toLowerCase());

export function isSalesVisible(role: string | null | undefined) {
  return role === "super_admin" || role === "admin" || role === "funeral_admin";
}

export function computeSalesOverview(requests: SalesRequest[]) {
  const paidRequests = requests.filter(isPaid);

  const totalRevenue = paidRequests.reduce((sum, r) => sum + moneyOf(r), 0);
  const totalSales = paidRequests.length;

  const now = new Date();
  const currentMonthKey = monthKey(now);

  let revenueThisMonth = 0;
  let salesThisMonth = 0;
  paidRequests.forEach((r) => {
    const date = toDate(r.paymentVerifiedAt || r.completedAt || r.createdAt);
    if (date && monthKey(date) === currentMonthKey) {
      revenueThisMonth += moneyOf(r);
      salesThisMonth += 1;
    }
  });

  const avgOrderValue = totalSales > 0 ? totalRevenue / totalSales : 0;

  const monthlySales: { label: string; value: number }[] = [];
  const monthlyRevenue: { label: string; value: number }[] = [];
  for (let i = 5; i >= 0; i -= 1) {
    const cursor = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = monthKey(cursor);
    let salesCount = 0;
    let revenueSum = 0;
    paidRequests.forEach((r) => {
      const date = toDate(r.paymentVerifiedAt || r.completedAt || r.createdAt);
      if (date && monthKey(date) === key) {
        salesCount += 1;
        revenueSum += moneyOf(r);
      }
    });
    monthlySales.push({ label: monthLabel(key), value: salesCount });
    monthlyRevenue.push({ label: monthLabel(key), value: Math.round(revenueSum) });
  }

  const breakdown: SalesBreakdown[] = [
    { label: "Completed", value: paidRequests.length, color: "#16a34a" },
    { label: "Payment Submitted", value: requests.filter((r) => String(r.status || "").toLowerCase() === "payment_submitted").length, color: "#2563eb" },
    { label: "Awaiting Payment", value: requests.filter((r) => String(r.status || "").toLowerCase() === "awaiting_payment").length, color: "#a66b1f" },
    { label: "Pending Acceptance", value: requests.filter((r) => String(r.status || "").toLowerCase() === "pending_shop_acceptance").length, color: "#f59e0b" },
    { label: "Declined", value: requests.filter((r) => String(r.status || "").toLowerCase() === "declined_by_shop").length, color: "#ef4444" },
    { label: "Cancelled", value: requests.filter((r) => String(r.status || "").toLowerCase() === "cancelled_by_requester").length, color: "#64748b" },
  ].filter((b) => b.value > 0);

  return {
    totalRevenue,
    totalSales,
    revenueThisMonth,
    salesThisMonth,
    avgOrderValue,
    monthlySales,
    monthlyRevenue,
    breakdown,
  };
}

export function formatCompactPeso(value: number) {
  if (value >= 1_000_000) {
    return `₱${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  }
  if (value >= 1_000) {
    return `₱${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}k`;
  }
  return `₱${Math.round(value)}`;
}
