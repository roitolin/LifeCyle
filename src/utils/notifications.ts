// Backward-compatible entry point. Keep one implementation so every caller gets
// multi-admin delivery, retry behavior, and notification deduplication.
export { createAdminNotification } from "./createAdminNotification";
export type { AdminNotificationType } from "./createAdminNotification";
