import { Suspense, lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from '@/components/ProtectedRoute'
import ChatWidget from '@/components/ChatWidget'
import LoadingBird from '@/components/LoadingBird'

const FuneralLandingPage = lazy(() => import('./pages/FuneralLandingPage'))
const FuneralShopsPage = lazy(() => import('./pages/FuneralShopsPage'))
const ProductDetailPage = lazy(() => import('./pages/ProductDetailPage'))
const CustomCasketRequestPage = lazy(() => import('./pages/CustomCasketRequestPage'))
const SellerCentrePage = lazy(() => import('./pages/SellerCentrePage'))
const SellerPaymentPage = lazy(() => import('./pages/SellerPaymentPage'))
const SellerServiceRequestPage = lazy(() => import('./pages/SellerServiceRequestPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage'))
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage'))
const UserProfilePage = lazy(() => import('./pages/UserProfilePage'))
const AccountSettingsPage = lazy(() => import('./pages/AccountSettingsPage'))
const PrivacyDataPage = lazy(() => import('./pages/PrivacyDataPage'))
const NotificationPreferencesPage = lazy(() => import('./pages/NotificationPreferencesPage'))
const ContactPage = lazy(() => import('./pages/ContactPage'))
const HelpCentrePage = lazy(() => import('./pages/HelpCentrePage'))
const AboutPage = lazy(() => import('./pages/AboutPage'))
const FeedbackPage = lazy(() => import('./pages/FeedbackPage'))
const PurchasePage = lazy(() => import('./pages/PurchasePage'))
const NotificationPage = lazy(() => import('./pages/NotificationPage'))
const LogoutPage = lazy(() => import('./pages/LogoutPage'))
const SwitchAccountPage = lazy(() => import('./pages/SwitchAccountPage'))
const CartPage = lazy(() => import('./pages/CartPage'))
const CheckoutPage = lazy(() => import('./pages/CheckoutPage'))
const MyServiceRequestsPage = lazy(() => import('./pages/MyServiceRequestsPage'))
const UserServiceRequestPage = lazy(() => import('./pages/UserServiceRequestPage'))
const PrivacyPolicyPage = lazy(() => import('./pages/PrivacyPolicyPage'))
const PoliciesPage = lazy(() => import('./pages/PoliciesPage'))
const ShopPage = lazy(() => import('./pages/ShopPage'))
const ShopRegistrationPage = lazy(() => import('./pages/ShopRegistrationPage'))
const FavoritesPage = lazy(() => import('./pages/FavoritesPage'))

const AdminAuditLogsPage = lazy(() => import('./pages/admin/AdminAuditLogsPage'))
const AdminAccountDeletionsPage = lazy(() => import('./pages/admin/AdminAccountDeletionsPage'))
const AdminAnalyticsPage = lazy(() => import('./pages/admin/AdminAnalyticsPage'))
const AdminAnnouncementsPage = lazy(() => import('./pages/admin/AdminAnnouncementsPage'))
const AdminLoginSecurityPage = lazy(() => import('./pages/admin/AdminLoginSecurityPage'))
const AdminDashboardPage = lazy(() => import('./pages/admin/AdminDashboardPage'))
const AdminFeedbackPage = lazy(() => import('./pages/admin/AdminFeedbackPage'))
const AdminFuneralItemsPage = lazy(() => import('./pages/admin/AdminFuneralItemsPage'))
const AdminFuneralShopsPage = lazy(() => import('./pages/admin/AdminFuneralShopsPage'))
const AdminHomeContentPage = lazy(() => import('./pages/admin/AdminHomeContentPage'))
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'))
const AdminModerationPage = lazy(() => import('./pages/admin/AdminModerationPage'))
const AdminOrdersPage = lazy(() => import('./pages/admin/AdminOrdersPage'))
const AdminProductDetailPage = lazy(() => import('./pages/admin/AdminProductDetailPage'))
const AdminServiceRequestDetailPage = lazy(() => import('./pages/admin/AdminServiceRequestDetailPage'))
const AdminPaymentsPage = lazy(() => import('./pages/admin/AdminPaymentsPage'))
const AdminPayoutAccountsPage = lazy(() => import('./pages/admin/AdminPayoutAccountsPage'))
const AdminRoleGuard = lazy(() => import('./pages/admin/AdminRoleGuard'))
const AdminRoleRedirectPage = lazy(() => import('./pages/admin/AdminRoleRedirectPage'))
const AdminShopCentrePage = lazy(() => import('./pages/admin/AdminShopCentrePage'))
const AdminShopDetailsPage = lazy(() => import('./pages/admin/AdminShopDetailsPage'))
const AdminSupportPage = lazy(() => import('./pages/admin/AdminSupportPage'))
const AdminUserDetailPage = lazy(() => import('./pages/admin/AdminUserDetailPage'))
const AdminUsersPage = lazy(() => import('./pages/admin/AdminUsersPage'))

function PageFallback() {
  return <LoadingBird fullScreen />
}

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<Navigate to="/funeral" replace />} />
          <Route path="/services" element={<Navigate to="/funeral" replace />} />
          <Route path="/funeral" element={<FuneralLandingPage />} />
          <Route path="/funeral/shops" element={<FuneralShopsPage />} />
          <Route path="/funeral/product/:productId" element={<ProductDetailPage />} />
          <Route path="/shop/:shopId" element={<ShopPage />} />
          <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
          <Route path="/policies" element={<PoliciesPage />} />
          <Route path="/seller" element={<SellerCentrePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/auth/logout" element={<LogoutPage />} />
          <Route path="/auth/switch-account" element={<SwitchAccountPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />

          {/* User Profile & Protected Routes */}
          <Route element={<ProtectedRoute />}>
            <Route path="/seller/register" element={<ShopRegistrationPage />} />
            <Route path="/seller/payment" element={<SellerPaymentPage />} />
            <Route path="/seller/requests/:requestId" element={<SellerServiceRequestPage />} />
            <Route path="/user/profile" element={<UserProfilePage />} />
            <Route path="/user/account-settings" element={<AccountSettingsPage />} />
            <Route path="/user/privacy-data" element={<PrivacyDataPage />} />
            <Route path="/user/notification-preferences" element={<NotificationPreferencesPage />} />
            <Route path="/user/favorites" element={<FavoritesPage />} />
            <Route path="/user/purchase" element={<PurchasePage />} />
            <Route path="/user/requests" element={<MyServiceRequestsPage />} />
            <Route path="/user/requests/:requestId" element={<UserServiceRequestPage />} />
            <Route path="/user/notifications" element={<NotificationPage />} />
            <Route path="/user/cart" element={<CartPage />} />
            <Route path="/user/checkout" element={<CheckoutPage />} />
            <Route path="/funeral/custom-casket/:shopId" element={<CustomCasketRequestPage />} />
            <Route path="/user/contact" element={<ContactPage />} />
            <Route path="/user/help" element={<HelpCentrePage />} />
            <Route path="/user/about" element={<AboutPage />} />
            <Route path="/user/feedback" element={<FeedbackPage />} />
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['super_admin', 'admin', 'funeral_admin']} redirectUnauthorizedTo="/funeral" />}>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminRoleRedirectPage />} />
              <Route path="dashboard" element={<AdminDashboardPage />} />
              <Route element={<AdminRoleGuard allowedRoles={['super_admin', 'admin', 'funeral_admin']} />}>
                <Route path="funeral-shops" element={<AdminFuneralShopsPage />} />
                <Route path="funeral-shops/:id/details" element={<AdminShopDetailsPage />} />
                <Route path="funeral-shops/:id" element={<AdminShopCentrePage />} />
                <Route path="funeral-items" element={<AdminFuneralItemsPage />} />
                <Route path="funeral-items/:productId" element={<AdminProductDetailPage />} />
                <Route path="orders" element={<AdminOrdersPage />} />
                <Route path="orders/:requestId" element={<AdminServiceRequestDetailPage />} />
                <Route path="payments" element={<AdminPaymentsPage />} />
                <Route path="payout-accounts" element={<AdminPayoutAccountsPage />} />
              </Route>
              <Route element={<AdminRoleGuard allowedRoles={['super_admin', 'admin']} />}>
                <Route path="analytics" element={<AdminAnalyticsPage />} />
                <Route path="announcements" element={<AdminAnnouncementsPage />} />
                <Route path="home-content" element={<AdminHomeContentPage />} />
                <Route path="account-deletions" element={<AdminAccountDeletionsPage />} />
              </Route>
              <Route path="users" element={<AdminUsersPage />} />
              <Route path="users/:id" element={<AdminUserDetailPage />} />
              <Route path="moderation" element={<AdminModerationPage />} />
              <Route path="feedback" element={<AdminFeedbackPage />} />
              <Route path="support" element={<AdminSupportPage />} />
              <Route path="activity-logs" element={<AdminAuditLogsPage />} />
              <Route path="login-security" element={<AdminLoginSecurityPage />} />
              <Route path="audit-logs" element={<Navigate to="/admin/activity-logs" replace />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <ChatWidget />
      </Suspense>
    </BrowserRouter>
  )
}

export default App
