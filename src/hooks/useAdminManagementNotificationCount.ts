import { useAdminManagementBreakdownCount } from "./useAdminManagementBreakdownCount";

export function useAdminManagementNotificationCount() {
  const { total } = useAdminManagementBreakdownCount();
  return total;
}
