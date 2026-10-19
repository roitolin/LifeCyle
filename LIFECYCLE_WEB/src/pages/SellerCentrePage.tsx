import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { acceptFuneralServiceRequest } from '@/utils/serviceRequestFlow'
import type { User } from '@supabase/supabase-js'
import './SellerCentrePage.css'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { addMonths, daysRemaining, formatSubscriptionDate, SUBSCRIPTION_MONTHS } from '@/utils/subscription'
import { fetchNotificationsForUser } from '@/utils/supabaseNotifications'
import XenditShopPaymentCard from '@/components/XenditShopPaymentCard'
import BrandLogo from '@/components/BrandLogo'
import PageBackButton from '@/components/PageBackButton'
import { PAYOUT_CHANNEL_LOGOS } from '@/assets/paymentLogoAssets'
import {
  createShopScheduleEvent,
  deleteShopScheduleEvent,
  listShopScheduleEvents,
  updateShopScheduleEvent,
  type ShopScheduleEvent,
  type ShopScheduleEventInput,
  type ShopScheduleEventType,
} from '@/utils/shopSchedule'

const EmbeddedChat = lazy(() => import('@/components/ChatWidget'))

type ShopInfo = {
  id: string
  shopName: string
  shopAddress: string
  shopPhoneNumber: string
  shopImageUrl: string | null
  coverImageUrl: string | null
  generalLocation: string
  status: string
  rejectionReason: string | null
  ownerId: string
  createdAt: string
  updatedAt: string
  paidUntil: string | null
  serviceCapacity: number | string | null
  payoutChannelCode: string | null
  payoutAccountName: string | null
  payoutAccountNumber: string | null
  payoutVerifiedByAdmin: boolean | null
  payoutVerifiedAt: string | null
  individualRegisteredName?: string | null
  businessName?: string | null
  registeredAddress?: string | null
  zipCode?: string | null
  tin?: string | null
  vatRegistrationStatus?: boolean | null
}

type ShopProfileDraft = {
  name: string
  address: string
  phone: string
  capacity: string
}

type ShopProduct = {
  id: string
  name: string
  description: string
  price: number
  stock: number
  imageUrl: string | null
  active: boolean
  hasVariations: boolean
  variationCount: number
  createdAt: string
  updatedAt: string
}

type PackageItem = {
  id: string
  name: string
  imageUrl?: string | null
}

type ShopPackage = {
  id?: string
  shopId?: string
  items: PackageItem[]
  flowersImageUrl?: string | null
  candlesImageUrl?: string | null
  curtainsImageUrl?: string | null
  vehicleImageUrl?: string | null
  active: boolean
  createdAt?: string | null
  updatedAt?: string | null
}

const MAX_PACKAGE_ITEMS = 12

function createPackageItemId() {
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `package-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function normalizePackageItems(row?: Partial<ShopPackage> | null): PackageItem[] {
  if (Array.isArray(row?.items) && row.items.length > 0) {
    return row.items
      .map(item => ({
        id: String(item?.id || createPackageItemId()),
        name: String(item?.name || ''),
        imageUrl: item?.imageUrl || null,
      }))
  }

  return [
    { id: 'legacy-flowers', name: 'Flowers', imageUrl: row?.flowersImageUrl },
    { id: 'legacy-candles', name: 'Candles', imageUrl: row?.candlesImageUrl },
    { id: 'legacy-curtains', name: 'Curtains', imageUrl: row?.curtainsImageUrl },
    { id: 'legacy-vehicle', name: 'Vehicle', imageUrl: row?.vehicleImageUrl },
  ].filter(item => Boolean(item.imageUrl))
}

type ServiceRequest = {
  id: string
  requesterId: string
  shopId?: string
  productId: string
  productName: string
  productPrice?: string
  productImageUrl?: string | null
  variationName?: string | null
  packageItems?: string[] | null
  requestType?: string
  customDesignNotes?: string | null
  referencePhotoUrl?: string | null
  deceasedFullName: string
  deceasedDateOfBirth?: string | null
  deceasedDateOfPassing?: string | null
  deceasedAge?: number | null
  tributeMessage: string
  contactNumber: string
  status: string
  paymentAmount?: number | string | null
  paymentPayerName?: string | null
  paymentGcashName?: string | null
  paymentGcashNumber?: string | null
  paymentReferenceNumber?: string | null
  paymentProofImageUrl?: string | null
  paymentRejectionReason?: string | null
  paymentSubmittedAt?: string | null
  paymentVerifiedAt?: string | null
  paymentProvider?: string | null
  providerPaymentId?: string | null
  providerPaymentMethod?: string | null
  providerReferenceId?: string | null
  providerStatus?: string | null
  providerPaymentCompletedAt?: string | null
  payoutChannelCode?: string | null
  completionProofImageUrl?: string | null
  shopMarkedCompletedAt?: string | null
  completionProofSeenAt?: string | null
  requesterName?: string | null
  familyCoordinatorName?: string | null
  wakeAddress?: string | null
  churchName?: string | null
  cemeteryName?: string | null
  wakeStartDate?: string | null
  wakeEndDate?: string | null
  burialTime?: string | null
  pickupAddress?: string | null
  memorialPhotoUrl?: string | null
  acceptedAt?: string | null
  declinedAt?: string | null
  cancelledAt?: string | null
  completedAt?: string | null
  shopRespondedAt?: string | null
  createdAt?: string
}

type CustomerSummary = {
  id: string
  name: string
  contactNumber: string
  arrangements: ServiceRequest[]
  activeCount: number
  completedCount: number
  totalValue: number
  lastActivity: string | null
}

async function notifyShopFollowersOnNewProduct(
  shopId: string,
  shopName: string,
  productId: string,
  productName: string
) {
  try {
    const { data: followers } = await supabase
      .from('shop_follows')
      .select('userId')
      .eq('shopId', shopId)
    if (!followers || followers.length === 0) return

    const rows = followers.map((follower: { userId: string }) => ({
      userId: follower.userId,
      type: 'funeral_new_product',
      title: `New product from ${shopName}`,
      body: `${shopName} just added "${productName}". View it now.`,
      data: { productId, shopId, shopName },
      read: false,
    }))
    await supabase.from('notifications').insert(rows)
  } catch {
    // Notification failure is non-blocking.
  }
}

type ProductVariation = {
  name: string
  price: string
  imageUrl: string | null
}

type ProductVariationDetail = {
  id: string
  name: string
  price: number | null
  imageUrl: string | null
}

type ProductImage = {
  id: string
  imageUrl: string | null
  displayOrder: number
}

type ProductFeedbackItem = {
  id: string
  displayName?: string | null
  userEmail?: string | null
  feedback: string
  ratingSnapshot?: number | null
  createdAt?: string | null
}

type ProductDetail = {
  variations: ProductVariationDetail[]
  images: ProductImage[]
  ratingCount: number
  averageRating: number
  feedbackCount: number
  feedbacks: ProductFeedbackItem[]
}

type ShopPayment = {
  id: string
  status: string
  amount: number
  createdAt: string
  verifiedAt: string | null
  expiresAt: string | null
}

type ShopPayoutAccount = {
  id: string
  shopId: string
  channelCode: string
  accountName: string
  accountNumber: string
  active: boolean
  verifiedByAdmin: boolean
  verifiedAt: string | null
  createdAt: string
  updatedAt: string
}

type FamilyPaymentFilter = 'all' | 'review' | 'verified'
type ArrangementFilter = 'all' | 'custom_casket'
type FamilyPaymentIconName = 'wallet' | 'clock' | 'check' | 'receipt' | 'person' | 'key' | 'image' | 'alert' | 'chevron'
type FamilyPaymentReceipt = {
  available: boolean
  label: string
  icon: FamilyPaymentIconName
  source: 'uploaded' | 'provider' | 'missing'
}
type SellerCentreTab = 'dashboard' | 'messages' | 'products' | 'packages' | 'orders' | 'customers' | 'calendar' | 'reports' | 'payments' | 'payout_accounts' | 'payout_account_setup' | 'admin_payments' | 'settings' | 'registered_information' | 'product_editor'
type ScheduleFilter = 'all' | 'requests' | 'shop'

type ScheduleItem = {
  id: string
  source: 'request' | 'shop'
  dateKey: string
  timeSort: string
  timeLabel: string
  title: string
  subtitle: string
  location: string | null
  kind: 'wake' | 'burial' | ShopScheduleEventType
  request?: ServiceRequest
  event?: ShopScheduleEvent
}

type ScheduleEventDraft = {
  title: string
  eventType: ShopScheduleEventType
  eventDate: string
  startTime: string
  endTime: string
  location: string
  notes: string
}

const SCHEDULE_EVENT_TYPES: { value: ShopScheduleEventType; label: string }[] = [
  { value: 'appointment', label: 'Appointment' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'blocked', label: 'Unavailable' },
  { value: 'other', label: 'Other' },
]

const EMPTY_SCHEDULE_DRAFT: ScheduleEventDraft = {
  title: '',
  eventType: 'appointment',
  eventDate: '',
  startTime: '09:00',
  endTime: '',
  location: '',
  notes: '',
}

const SHOP_PAYOUT_CHANNELS = [
  { value: 'PH_GCASH', label: 'GCash', type: 'wallet' },
  { value: 'PH_MAYA', label: 'Maya', type: 'wallet' },
  { value: 'PH_BDO', label: 'BDO Unibank', type: 'bank' },
  { value: 'PH_BPI', label: 'Bank of the Philippine Islands (BPI)', type: 'bank' },
  { value: 'PH_METROBANK', label: 'Metrobank', type: 'bank' },
  { value: 'PH_LANDBANK', label: 'Landbank of the Philippines', type: 'bank' },
  { value: 'PH_CHINABANK', label: 'China Banking Corporation', type: 'bank' },
] as const

function PayoutChannelLogo({ channelCode, label, fallback }: { channelCode: string; label: string; fallback: string }) {
  const logoUrl = PAYOUT_CHANNEL_LOGOS[channelCode]

  return logoUrl ? (
    <img className={channelCode === 'PH_MAYA' ? 'is-maya' : undefined} src={logoUrl} alt={`${label} logo`} />
  ) : <>{fallback}</>
}

function getPayoutChannelLabel(value: string | null | undefined) {
  return SHOP_PAYOUT_CHANNELS.find(channel => channel.value === value)?.label || value || 'Not selected'
}

function maskPayoutAccount(value: string | null | undefined) {
  const clean = String(value || '').trim()
  if (!clean) return 'Not provided'
  if (clean.length <= 4) return clean
  return `${'•'.repeat(Math.min(6, clean.length - 4))}${clean.slice(-4)}`
}

function FamilyPaymentIcon({ name }: { name: FamilyPaymentIconName }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }

  if (name === 'wallet') return <svg {...common}><path d="M4 6.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3v-11a3 3 0 0 1 3-3h12"/><path d="M16 11h5v5h-5a2.5 2.5 0 0 1 0-5Z"/></svg>
  if (name === 'clock') return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
  if (name === 'check') return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></svg>
  if (name === 'receipt') return <svg {...common}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/></svg>
  if (name === 'person') return <svg {...common}><circle cx="12" cy="8" r="3"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/></svg>
  if (name === 'key') return <svg {...common}><circle cx="8" cy="15" r="3"/><path d="m10.5 13.5 8-8M16 6l2 2M13.5 8.5l2 2"/></svg>
  if (name === 'image') return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 15-4-4L6 20"/></svg>
  if (name === 'alert') return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
  if (name === 'chevron') return <svg {...common}><path d="m9 18 6-6-6-6"/></svg>
  return <svg {...common}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/></svg>
}

function getFamilyPaymentStatus(request: ServiceRequest) {
  const status = String(request.status || '').toLowerCase()
  if (status === 'payment_submitted') {
    return { label: 'Needs review', icon: 'clock' as FamilyPaymentIconName, className: 'is-review' }
  }
  if (request.paymentVerifiedAt || ['payment_verified', 'awaiting_customer_confirmation', 'completed'].includes(status)) {
    return { label: 'Verified', icon: 'check' as FamilyPaymentIconName, className: 'is-verified' }
  }
  return { label: 'Submitted', icon: 'receipt' as FamilyPaymentIconName, className: 'is-submitted' }
}

function getFamilyPaymentReceipt(request: ServiceRequest): FamilyPaymentReceipt {
  if (request.paymentProofImageUrl) {
    return { available: true, label: 'Uploaded receipt', icon: 'image', source: 'uploaded' }
  }

  const status = String(request.status || '').toLowerCase()
  const provider = String(request.paymentProvider || '').toLowerCase()
  const isProviderPayment = ['xendit', 'paymongo'].includes(provider)
    || Boolean(request.providerPaymentId || request.providerPaymentCompletedAt)
  const isSettled = Boolean(request.paymentVerifiedAt || request.providerPaymentCompletedAt)
    || ['payment_verified', 'awaiting_customer_confirmation', 'completed'].includes(status)

  if (isProviderPayment && isSettled) {
    return {
      available: true,
      label: 'Digital receipt available',
      icon: 'receipt',
      source: 'provider',
    }
  }

  return { available: false, label: 'Receipt missing', icon: 'alert', source: 'missing' }
}

function formatPeso(value: number | string | null | undefined): string {
  const num = Number(String(value ?? '').replace(/[^\d.]/g, ''))
  if (!Number.isFinite(num) || num <= 0) return value ? String(value) : '—'
  return `₱${new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 }).format(num)}`
}

function isCustomCasketRequest(request: ServiceRequest): boolean {
  return request.requestType === 'custom_casket' || request.productId === 'custom_casket_design'
}

function getRequestImageUrl(request: ServiceRequest): string | null {
  return isCustomCasketRequest(request)
    ? (request.referencePhotoUrl || request.productImageUrl || null)
    : (request.productImageUrl || null)
}

function dedupeServiceRequests(requests: ServiceRequest[]): ServiceRequest[] {
  const seen = new Map<string, ServiceRequest>()
  return requests.filter(request => {
    if (!isCustomCasketRequest(request)) return true
    const signature = [
      request.requesterId,
      request.shopId || '',
      request.productId,
      request.deceasedFullName,
      request.contactNumber,
      request.wakeStartDate,
      request.wakeEndDate,
      request.burialTime,
      request.customDesignNotes,
    ].map(value => String(value || '').trim().toLowerCase()).join('|')
    const previous = seen.get(signature)
    const currentTime = Date.parse(String(request.createdAt || ''))
    const previousTime = previous ? Date.parse(String(previous.createdAt || '')) : NaN
    if (
      previous &&
      Number.isFinite(currentTime) &&
      Number.isFinite(previousTime) &&
      Math.abs(currentTime - previousTime) <= 2 * 60 * 1000
    ) return false
    seen.set(signature, request)
    return true
  })
}

function parseCustomCasketPrice(value: string | undefined): number {
  const amount = Number(String(value ?? '').replace(/[^\d.]/g, ''))
  return Number.isFinite(amount) ? amount : 0
}

function formatCompactPeso(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '₱0'
  return `₱${new Intl.NumberFormat('en-PH', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)}`
}

function getProductState(item: ShopProduct) {
  if (!item.active || item.stock <= 0) return 'soldout'
  return 'live'
}

function Stars({ value }: { value: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(value || 0)))
  return (
    <span className="sc-stars" aria-label={`${value} out of 5 stars`}>
      {'★'.repeat(filled)}
      {'☆'.repeat(5 - filled)}
    </span>
  )
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(String(value))
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })
}

function formatScheduleDate(value: string | null | undefined): string {
  if (!value) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  const parsed = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
}

function formatScheduleTime(value: string | null | undefined): string {
  if (!value) return '—'
  const match = /^(\d{1,2}):(\d{2})/.exec(value)
  if (!match) return value
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return value
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`
}

function toScheduleDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function scheduleDateFromKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return toScheduleDateKey(date) === value ? date : null
}

function normalizeScheduleDate(value: string | null | undefined): string | null {
  if (!value) return null
  const dateKey = String(value).slice(0, 10)
  return scheduleDateFromKey(dateKey) ? dateKey : null
}

function buildScheduleCalendarDays(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const firstCell = new Date(first)
  firstCell.setDate(first.getDate() - first.getDay())
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstCell)
    date.setDate(firstCell.getDate() + index)
    return date
  })
}

function formatScheduleDayHeading(value: string): string {
  const date = scheduleDateFromKey(value)
  return date
    ? date.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' })
    : value
}

function buildRequestScheduleItems(requests: ServiceRequest[]): ScheduleItem[] {
  const items: ScheduleItem[] = []
  requests.forEach(request => {
    const name = request.deceasedFullName || request.productName || 'Service request'
    const subtitle = [request.productName || 'Funeral service', request.familyCoordinatorName || request.requesterName]
      .filter(Boolean)
      .join(' · ')
    const wakeStart = normalizeScheduleDate(request.wakeStartDate)
    const wakeEnd = normalizeScheduleDate(request.wakeEndDate)

    if (wakeStart) {
      items.push({
        id: `wake-start-${request.id}`,
        source: 'request',
        dateKey: wakeStart,
        timeSort: '00:00',
        timeLabel: 'All day',
        title: `Wake begins · ${name}`,
        subtitle,
        location: request.wakeAddress || null,
        kind: 'wake',
        request,
      })
    }
    if (wakeEnd && wakeEnd !== wakeStart) {
      items.push({
        id: `wake-end-${request.id}`,
        source: 'request',
        dateKey: wakeEnd,
        timeSort: '00:01',
        timeLabel: 'All day',
        title: `Wake ends · ${name}`,
        subtitle,
        location: request.wakeAddress || null,
        kind: 'wake',
        request,
      })
    }
    if (wakeEnd && request.burialTime) {
      items.push({
        id: `burial-${request.id}`,
        source: 'request',
        dateKey: wakeEnd,
        timeSort: String(request.burialTime).slice(0, 5) || '12:00',
        timeLabel: formatScheduleTime(request.burialTime),
        title: `Burial service · ${name}`,
        subtitle,
        location: request.cemeteryName || request.pickupAddress || request.wakeAddress || null,
        kind: 'burial',
        request,
      })
    }
  })
  return items
}

function buildShopScheduleItem(event: ShopScheduleEvent): ScheduleItem {
  const typeLabel = SCHEDULE_EVENT_TYPES.find(type => type.value === event.event_type)?.label || 'Shop event'
  const start = event.start_time ? formatScheduleTime(event.start_time) : 'All day'
  const end = event.end_time ? ` – ${formatScheduleTime(event.end_time)}` : ''
  return {
    id: `shop-${event.id}`,
    source: 'shop',
    dateKey: event.event_date,
    timeSort: event.start_time || '00:00',
    timeLabel: `${start}${end}`,
    title: event.title,
    subtitle: typeLabel,
    location: event.location,
    kind: event.event_type,
    event,
  }
}

type SellerNotification = {
  id: string
  title?: string
  message?: string
  body?: string
  type?: string
  read?: boolean
  data?: Record<string, unknown> | null
  createdAt?: string | null
}

function getTimeLabel(value: string | null | undefined) {
  if (!value) return ''
  const parsed = new Date(String(value))
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
}

function shopStatusMeta(status: string, rejectionReason: string | null) {
  const s = String(status || '').toLowerCase()
  if (s === 'live') {
    return {
      label: 'Live',
      title: 'Storefront is live',
      message: 'Your shop is live and visible to families. Manage your storefront and catalog here.',
      background: '#e6f7ff',
      border: '#91caff',
      text: '#0958d9',
      chipText: '#0958d9',
      chipBackground: '#f5fbff',
    }
  }
  if (s === 'verified') {
    return {
      label: 'Verified',
      title: 'Storefront ready',
      message: 'Your shop is approved. You can edit the storefront and manage your catalog.',
      background: '#e7f5ec',
      border: '#bfe3cc',
      text: '#1e5b3a',
      chipText: '#1e5b3a',
      chipBackground: '#f7fffa',
    }
  }
  if (s === 'offline') {
    return {
      label: 'Offline',
      title: 'Storefront is offline',
      message: 'Your shop is currently hidden from buyers. You can still edit the storefront and manage your catalog.',
      background: '#f0f0f0',
      border: '#d9d9d9',
      text: '#595959',
      chipText: '#595959',
      chipBackground: '#fafafa',
    }
  }
  if (s === 'pending') {
    return {
      label: 'Pending Review',
      title: 'Waiting for approval',
      message: 'Your shop profile is under review. You can still look around while you wait.',
      background: '#fff4e5',
      border: '#f2d2a2',
      text: '#9a5417',
      chipText: '#8a4a13',
      chipBackground: '#fffaf3',
    }
  }
  if (s === 'rejected') {
    return {
      label: 'Needs Changes',
      title: 'Profile needs updates',
      message: rejectionReason || 'Your last submission needs changes before it can be approved again.',
      background: '#fdecec',
      border: '#f3c2c2',
      text: '#8f2525',
      chipText: '#8f2525',
      chipBackground: '#fff8f8',
    }
  }
  return {
    label: 'Setup Needed',
    title: 'Finish your storefront setup',
    message: 'Complete your shop registration so families can view your storefront and products.',
    background: '#f2ede6',
    border: '#dfd4c6',
    text: '#65584d',
    chipText: '#65584d',
    chipBackground: '#fffdfa',
  }
}

export default function SellerCentrePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { openAlert, alertDialog } = useAlertDialog()
  const { openConfirm, confirmDialog } = useConfirmDialog()
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [shop, setShop] = useState<ShopInfo | null>(null)
  const [products, setProducts] = useState<ShopProduct[]>([])
  const [packages, setPackages] = useState<ShopPackage[]>([])
  const [requests, setRequests] = useState<ServiceRequest[]>([])
  const [activeTab, setActiveTab] = useState<SellerCentreTab>(() => {
    const requestedTab = searchParams.get('tab')
    if (requestedTab === 'messages' || requestedTab === 'orders' || requestedTab === 'settings' || requestedTab === 'registered_information') {
      return requestedTab
    }
    return 'dashboard'
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [productTab, setProductTab] = useState<'all' | 'live' | 'soldout'>('all')
  const [saving, setSaving] = useState(false)
  const [uploadingShopProfile, setUploadingShopProfile] = useState(false)
  const [uploadingShopCover, setUploadingShopCover] = useState(false)
  const [editingShopProfile, setEditingShopProfile] = useState(false)
  const [savingShopProfile, setSavingShopProfile] = useState(false)
  const [shopProfileDraft, setShopProfileDraft] = useState<ShopProfileDraft>({
    name: '',
    address: '',
    phone: '',
    capacity: '1',
  })
  const [payoutDraft, setPayoutDraft] = useState({ channel: '', name: '', number: '' })
  const [payoutAccounts, setPayoutAccounts] = useState<ShopPayoutAccount[]>([])
  const [savingPayout, setSavingPayout] = useState(false)
  const [payment, setPayment] = useState<ShopPayment | null>(null)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notifications, setNotifications] = useState<SellerNotification[]>([])
  const [sidebarExpanded, setSidebarExpanded] = useState<Record<string, boolean>>({ order: true, product: true, finance: true, setting: true })
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [paymentVerifyingId, setPaymentVerifyingId] = useState('')
  const [familyPaymentFilter, setFamilyPaymentFilter] = useState<FamilyPaymentFilter>('all')
  const [arrangementFilter, setArrangementFilter] = useState<ArrangementFilter>('all')
  const [customerSearch, setCustomerSearch] = useState('')
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [scheduleMonth, setScheduleMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [selectedScheduleDate, setSelectedScheduleDate] = useState(() => toScheduleDateKey(new Date()))
  const [scheduleFilter, setScheduleFilter] = useState<ScheduleFilter>('all')
  const [shopScheduleEvents, setShopScheduleEvents] = useState<ShopScheduleEvent[]>([])
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false)
  const [editingScheduleEvent, setEditingScheduleEvent] = useState<ShopScheduleEvent | null>(null)
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleEventDraft>(EMPTY_SCHEDULE_DRAFT)
  const [savingScheduleEvent, setSavingScheduleEvent] = useState(false)

  useEffect(() => {
    const requestedTab = searchParams.get('tab')
    if (requestedTab === 'messages' || requestedTab === 'orders' || requestedTab === 'settings' || requestedTab === 'registered_information') {
      setActiveTab(requestedTab)
    }
  }, [searchParams])

  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  useEffect(() => {
    if (!mobileNavOpen) return
    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavOpen(false)
    }
    const closeAboveMobile = () => {
      if (window.innerWidth > 768) setMobileNavOpen(false)
    }
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', closeAboveMobile)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', closeAboveMobile)
    }
  }, [mobileNavOpen])

  const toggleSidebarGroup = (group: 'order' | 'product' | 'finance' | 'setting') => {
    setSidebarExpanded((current) => ({
      ...current,
      [group]: sidebarOpen ? !current[group] : true,
    }))
    if (!sidebarOpen) setSidebarOpen(true)
  }

  // Product details viewer
  const [selectedProduct, setSelectedProduct] = useState<ShopProduct | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailData, setDetailData] = useState<ProductDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [galleryIndex, setGalleryIndex] = useState(0)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  // Service request details viewer
  const [viewRequest, setViewRequest] = useState<ServiceRequest | null>(null)
  const [customPriceDrafts, setCustomPriceDrafts] = useState<Record<string, string>>({})
  const [proofLightboxUrl, setProofLightboxUrl] = useState<string | null>(null)

  // Completion proof upload (required before marking a request completed)
  const completionProofFileInputRef = useRef<HTMLInputElement | null>(null)
  const [completionProofFile, setCompletionProofFile] = useState<File | null>(null)
  const [completionProofPreview, setCompletionProofPreview] = useState<string | null>(null)
  const [uploadingCompletionProof, setUploadingCompletionProof] = useState(false)

  // Product Editor States
  const [editingProductId, setEditingProductId] = useState<string | null>(null)
  const [editorLoading, setEditorLoading] = useState(false)
  const [editorName, setEditorName] = useState("")
  const [editorPrice, setEditorPrice] = useState("")
  const [editorStock, setEditorStock] = useState("1")
  const [editorHasVariations, setEditorHasVariations] = useState(false)
  const [editorVariationEntries, setEditorVariationEntries] = useState<ProductVariation[]>([])
  const [editorDescription, setEditorDescription] = useState("")
  const [editorImages, setEditorImages] = useState<(string | null)[]>([null])
  const [editorUploadingIndex, setEditorUploadingIndex] = useState<number | null>(null)
  const [packageSaving, setPackageSaving] = useState(false)
  const [uploadingPackageItemId, setUploadingPackageItemId] = useState<string | null>(null)

  const openProductEditor = async (productId: string | null) => {
    setEditingProductId(productId)
    setActiveTab('product_editor')
    if (!productId) {
      setEditorName("")
      setEditorPrice("")
      setEditorStock("1")
      setEditorHasVariations(false)
      setEditorVariationEntries([{ name: "", price: "", imageUrl: null }])
      setEditorDescription("")
      setEditorImages([null])
      return
    }

    setEditorLoading(true)
    try {
      const { data, error } = await supabase
        .from('funeral_products')
        .select(`
          *,
          funeral_product_variations ( id, name, price, imageUrl ),
          funeral_product_images ( id, imageUrl, displayOrder )
        `)
        .eq('id', productId)
        .single()

      if (error) throw error
      if (data) {
        setEditorName(data.name || "")
        setEditorPrice(String(data.price || ""))
        setEditorStock(String(data.stock ?? 1))
        
        const galleryImageUrls = (data.funeral_product_images || [])
          .sort((a: any, b: any) => (a.displayOrder || 0) - (b.displayOrder || 0))
          .map((img: any) => img.imageUrl as string)
          .filter(Boolean)
        setEditorImages(galleryImageUrls.length > 0 ? galleryImageUrls : [null])

        const vars = (data.funeral_product_variations || []).map((v: any) => ({
          name: v.name || "",
          price: v.price == null ? "" : String(v.price),
          imageUrl: v.imageUrl || null
        }))
        setEditorVariationEntries(vars.length > 0 ? vars : [{ name: "", price: "", imageUrl: null }])
        setEditorHasVariations(Boolean(data.hasVariations && vars.length > 0))
        setEditorDescription(data.description || "")
      }
    } catch (err: any) {
      openAlert({ title: 'Load Failed', message: "Error loading product: " + err.message, tone: 'danger', okLabel: 'Dismiss' })
      setActiveTab('products')
    } finally {
      setEditorLoading(false)
    }
  }

  const handleUploadImage = async (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user) return

    setEditorUploadingIndex(index)
    try {
      const ext = file.name.split('.').pop()
      const path = `products/${user.id}_${Date.now()}_${index}.${ext}`
      const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
      if (uploadError) throw uploadError

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
      const newURL = urlData.publicUrl

      setEditorImages(prev => prev.map((img, idx) => idx === index ? newURL : img))
    } catch (err: any) {
      openAlert({ title: 'Upload Failed', message: "Upload failed: " + err.message, tone: 'danger', okLabel: 'Dismiss' })
    } finally {
      setEditorUploadingIndex(null)
    }
  }

  const handleUploadVariationImage = async (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user) return

    setEditorUploadingIndex(100 + index)
    try {
      const ext = file.name.split('.').pop()
      const path = `variations/${user.id}_${Date.now()}_${index}.${ext}`
      const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
      if (uploadError) throw uploadError

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
      const newURL = urlData.publicUrl

      setEditorVariationEntries(prev => prev.map((v, idx) => idx === index ? { ...v, imageUrl: newURL } : v))
    } catch (err: any) {
      openAlert({ title: 'Upload Failed', message: "Upload failed: " + err.message, tone: 'danger', okLabel: 'Dismiss' })
    } finally {
      setEditorUploadingIndex(null)
    }
  }

  const handleUploadShopImage = async (e: React.ChangeEvent<HTMLInputElement>, field: 'shopImageUrl' | 'coverImageUrl') => {
    const file = e.target.files?.[0]
    if (!file || !user) return

    if (!file.type.startsWith('image/')) {
      openAlert({ title: 'Invalid File', message: 'Please choose an image file.', tone: 'warning', okLabel: 'Got It' })
      return
    }

    if (field === 'shopImageUrl') setUploadingShopProfile(true)
    else setUploadingShopCover(true)

    try {
      const ext = file.name.split('.').pop()
      const path = `shops/${user.id}_${field}_${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
      if (uploadError) throw uploadError

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
      const newURL = urlData.publicUrl

      const { error: updateError } = await supabase
        .from('funeral_shops')
        .update({ [field]: newURL, updatedAt: new Date().toISOString() })
        .eq('id', user.id)
      if (updateError) throw updateError

      setShop(prev => (prev ? { ...prev, [field]: newURL } : prev))
      openAlert({
        title: 'Photo Updated',
        message: 'Shop ' + (field === 'shopImageUrl' ? 'profile' : 'cover') + ' photo updated.',
        tone: 'info',
        okLabel: 'Done',
      })
    } catch (err: any) {
      openAlert({ title: 'Upload Failed', message: 'Upload failed: ' + err.message, tone: 'danger', okLabel: 'Dismiss' })
    } finally {
      setUploadingShopProfile(false)
      setUploadingShopCover(false)
      e.target.value = ''
    }
  }

  const createShopProfileDraft = (currentShop: ShopInfo): ShopProfileDraft => ({
    name: currentShop.shopName || '',
    address: currentShop.shopAddress || '',
    phone: currentShop.shopPhoneNumber || '',
    capacity: String(Math.max(1, Number(currentShop.serviceCapacity) || 1)),
  })

  const openShopProfileEditor = () => {
    if (!shop) return
    setShopProfileDraft(createShopProfileDraft(shop))
    setEditingShopProfile(true)
  }

  const cancelShopProfileEditor = () => {
    if (shop) setShopProfileDraft(createShopProfileDraft(shop))
    setEditingShopProfile(false)
  }

  const saveShopProfile = async () => {
    if (!user || !shop || savingShopProfile) return

    const name = shopProfileDraft.name.trim().replace(/\s+/g, ' ')
    const address = shopProfileDraft.address.trim().replace(/\s+/g, ' ')
    const phone = shopProfileDraft.phone.trim().replace(/\s+/g, ' ')
    const capacity = Number(shopProfileDraft.capacity)

    if (!name || !address || !phone) {
      openAlert({
        title: 'Missing Information',
        message: 'Shop name, public address, and phone number are required.',
        tone: 'warning',
        okLabel: 'Got It',
      })
      return
    }
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 20) {
      openAlert({
        title: 'Invalid Capacity',
        message: 'Service capacity must be a whole number from 1 to 20.',
        tone: 'warning',
        okLabel: 'Got It',
      })
      return
    }

    setSavingShopProfile(true)
    try {
      const update = {
        shopName: name,
        shopAddress: address,
        shopPhoneNumber: phone,
        serviceCapacity: capacity,
        updatedAt: new Date().toISOString(),
      }
      const { error: updateError } = await supabase
        .from('funeral_shops')
        .update(update)
        .eq('id', shop.id)
      if (updateError) throw updateError

      setShop(current => current ? { ...current, ...update } : current)
      setShopProfileDraft({ name, address, phone, capacity: String(capacity) })
      setEditingShopProfile(false)
      openAlert({
        title: 'Shop Profile Updated',
        message: 'Your public storefront information has been saved.',
        tone: 'info',
        okLabel: 'Done',
      })
    } catch (err: any) {
      openAlert({
        title: 'Save Failed',
        message: err?.message || 'Unable to update the shop profile.',
        tone: 'danger',
        okLabel: 'Dismiss',
      })
    } finally {
      setSavingShopProfile(false)
    }
  }

  const savePayoutAccount = async () => {
    if (!user || !shop || savingPayout) return

    const channel = payoutDraft.channel.trim().toUpperCase()
    const accountName = payoutDraft.name.trim()
    const accountNumber = payoutDraft.number.trim().replace(/[\s-]+/g, '')
    const validChannel = SHOP_PAYOUT_CHANNELS.some(item => item.value === channel)

    if (!validChannel) {
      openAlert({ title: 'Select a Payout Account', message: 'Choose an e-wallet or supported bank account.', tone: 'warning', okLabel: 'Got It' })
      return
    }
    if (accountName.length < 2 || accountName.length > 120) {
      openAlert({ title: 'Check Account Name', message: 'Enter the registered account holder name.', tone: 'warning', okLabel: 'Got It' })
      return
    }
    if (accountNumber.length < 4 || accountNumber.length > 30) {
      openAlert({ title: 'Check Account Number', message: 'Enter a valid GCash, Maya, or bank account number.', tone: 'warning', okLabel: 'Got It' })
      return
    }

    setSavingPayout(true)
    try {
      const { data, error: functionError } = await supabase.functions.invoke('provision-xendit-shop', {
        body: {
          shopId: shop.id,
          action: 'update',
          payoutChannelCode: channel,
          payoutAccountName: accountName,
          payoutAccountNumber: accountNumber,
        },
      })

      if (functionError) {
        let message = 'Unable to save the payout account.'
        const context = (functionError as { context?: Response }).context
        if (context && typeof context.json === 'function') {
          try {
            const body = await context.json()
            if (typeof body?.error === 'string' && body.error.trim()) message = body.error
          } catch {
            // Keep the safe fallback message.
          }
        }
        throw new Error(message)
      }
      if (!data || data.shopId !== shop.id) throw new Error('The payout account could not be confirmed.')

      setPayoutDraft({ channel, name: accountName, number: accountNumber })
      setShop(current => current ? {
        ...current,
        payoutChannelCode: channel,
        payoutAccountName: accountName,
        payoutAccountNumber: accountNumber,
        payoutVerifiedByAdmin: false,
        payoutVerifiedAt: null,
      } : current)
      setActiveTab('payout_accounts')
      await loadData()
      openAlert({
        title: 'Payout Account Submitted',
        message: 'Your payout details were saved and are now waiting for administrator verification.',
        tone: 'info',
        okLabel: 'Done',
      })
    } catch (err: unknown) {
      openAlert({
        title: 'Save Failed',
        message: err instanceof Error ? err.message : 'Unable to save the payout account.',
        tone: 'danger',
        okLabel: 'Dismiss',
      })
    } finally {
      setSavingPayout(false)
    }
  }

  const openPayoutAccountEditor = (account?: ShopPayoutAccount, channelCode?: string) => {
    setPayoutDraft(account ? {
      channel: account.channelCode,
      name: account.accountName,
      number: account.accountNumber,
    } : { channel: channelCode || '', name: '', number: '' })
    setActiveTab('payout_account_setup')
  }

  const togglePayoutAccount = async (account: ShopPayoutAccount) => {
    if (!shop || savingPayout) return
    setSavingPayout(true)
    try {
      const { error: functionError } = await supabase.functions.invoke('provision-xendit-shop', {
        body: {
          shopId: shop.id,
          action: 'set-active',
          payoutChannelCode: account.channelCode,
          active: !account.active,
        },
      })
      if (functionError) throw functionError
      await loadData()
    } catch (err: unknown) {
      openAlert({
        title: 'Update Failed',
        message: err instanceof Error ? err.message : 'Unable to change the receiver account status.',
        tone: 'danger',
        okLabel: 'Dismiss',
      })
    } finally {
      setSavingPayout(false)
    }
  }

  const handleCompletionProofFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0]
    if (!selected) return

    if (!selected.type.startsWith('image/')) {
      openAlert({ title: 'Invalid File', message: 'Please choose an image file for the completion proof.', tone: 'warning', okLabel: 'Got It' })
      event.target.value = ''
      return
    }

    if (completionProofPreview) URL.revokeObjectURL(completionProofPreview)
    setCompletionProofFile(selected)
    setCompletionProofPreview(URL.createObjectURL(selected))
  }

  const clearCompletionProofSelection = () => {
    if (completionProofPreview) URL.revokeObjectURL(completionProofPreview)
    setCompletionProofFile(null)
    setCompletionProofPreview(null)
    if (completionProofFileInputRef.current) completionProofFileInputRef.current.value = ''
  }

  const openRequestDetail = (request: ServiceRequest) => {
    clearCompletionProofSelection()
    navigate(`/seller/requests/${request.id}`)
  }

  const handleSaveProduct = async () => {
    if (!user) return

    if (!editorName.trim() || !editorPrice.trim()) {
      openAlert({ title: 'Missing Details', message: "Product name and price are required.", tone: 'warning', okLabel: 'Got It' })
      return
    }

    const priceValue = Number(editorPrice.trim().replace(/[^\d.]/g, ""))
    if (isNaN(priceValue) || priceValue <= 0) {
      openAlert({ title: 'Invalid Price', message: "Invalid price. Please enter a valid amount.", tone: 'warning', okLabel: 'Got It' })
      return
    }

    const stockValue = Number(editorStock)
    if (isNaN(stockValue) || stockValue < 0) {
      openAlert({ title: 'Invalid Stock', message: "Stock must be 0 or higher.", tone: 'warning', okLabel: 'Got It' })
      return
    }

    const uploadedCount = editorImages.filter(Boolean).length
    if (uploadedCount < 1) {
      openAlert({ title: 'Photo Required', message: "Please upload at least 1 product photo.", tone: 'warning', okLabel: 'Got It' })
      return
    }

    const finalVars = editorHasVariations ? editorVariationEntries : []
    if (editorHasVariations) {
      const hasInvalidVar = finalVars.some(v => {
        const variationPrice = Number(String(v.price || '').replace(/[^\d.]/g, ''))
        return !v.name.trim() || !v.imageUrl || !Number.isFinite(variationPrice) || variationPrice <= 0
      })
      if (hasInvalidVar) {
        openAlert({ title: 'Incomplete Variations', message: "Each variation needs a name, price, and image.", tone: 'warning', okLabel: 'Got It' })
        return
      }
    }

    setSaving(true)
    const finalProductId = editingProductId || (crypto.randomUUID?.() ?? 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16)))

    try {
      const { error: productError } = await supabase.from("funeral_products").upsert({
        id: finalProductId,
        shopId: user.id,
        name: editorName.trim(),
        description: editorDescription.trim(),
        price: priceValue,
        stock: stockValue,
        imageUrl: editorImages[0] || null,
        hasVariations: editorHasVariations,
        active: stockValue > 0,
        updatedAt: new Date().toISOString(),
      })
      if (productError) throw productError

      await supabase.from("funeral_product_images").delete().eq("productId", finalProductId)
      const imageRows = editorImages.filter(Boolean).map((url, index) => ({
        productId: finalProductId,
        imageUrl: url,
        displayOrder: index,
      }))
      if (imageRows.length > 0) {
        await supabase.from("funeral_product_images").insert(imageRows)
      }

      await supabase.from("funeral_product_variations").delete().eq("productId", finalProductId)
      if (editorHasVariations && finalVars.length > 0) {
        const variationRows = finalVars.map(v => ({
          productId: finalProductId,
          name: v.name.trim(),
          price: Number(String(v.price || '').replace(/[^\d.]/g, '')),
          imageUrl: v.imageUrl || null,
        }))
        await supabase.from("funeral_product_variations").insert(variationRows)
      }

      if (!editingProductId && stockValue > 0) {
        await notifyShopFollowersOnNewProduct(
          user.id,
          shop?.shopName || 'A funeral shop',
          finalProductId,
          editorName.trim()
        )
      }

      openAlert({
        title: editingProductId ? 'Product Updated' : 'Product Added',
        message: editingProductId ? "Product updated successfully!" : "Product added successfully!",
        tone: 'info',
        okLabel: 'Done',
      })
      setActiveTab('products')
      void loadData()
    } catch (err: any) {
      openAlert({ title: 'Save Failed', message: "Failed to save product: " + err.message, tone: 'danger', okLabel: 'Dismiss' })
    } finally {
      setSaving(false)
    }
  }

  const addPackageItem = () => {
    if (!user) return
    setPackages(previous => {
      const current = previous[0] || { shopId: user.id, active: true, items: [] }
      const items = normalizePackageItems(current)
      if (items.length >= MAX_PACKAGE_ITEMS) return previous.length ? previous : [current]
      return [{ ...current, items: [...items, { id: createPackageItemId(), name: '', imageUrl: null }] }]
    })
  }

  const updatePackageItem = (itemId: string, updates: Partial<PackageItem>) => {
    if (!user) return
    setPackages(previous => {
      const current = previous[0] || { shopId: user.id, active: true, items: [] }
      return [{
        ...current,
        items: normalizePackageItems(current).map(item => item.id === itemId ? { ...item, ...updates } : item),
      }]
    })
  }

  const removePackageItem = (itemId: string) => {
    if (!user) return
    setPackages(previous => {
      const current = previous[0] || { shopId: user.id, active: true, items: [] }
      return [{ ...current, items: normalizePackageItems(current).filter(item => item.id !== itemId) }]
    })
  }

  const handlePackageImageUpload = async (itemId: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !user) return
    if (!file.type.startsWith('image/')) {
      openAlert({ title: 'Invalid File', message: 'Please choose an image file.', tone: 'warning', okLabel: 'Got It' })
      return
    }

    setUploadingPackageItemId(itemId)
    try {
      const ext = file.name.split('.').pop()
      const path = `packages/${user.id}_${itemId}_${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
      if (uploadError) throw uploadError
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
      updatePackageItem(itemId, { imageUrl: urlData.publicUrl })
    } catch (err: any) {
      openAlert({ title: 'Upload Failed', message: err?.message || 'Unable to upload package picture.', tone: 'danger', okLabel: 'Dismiss' })
    } finally {
      setUploadingPackageItemId(null)
      event.target.value = ''
    }
  }

  const handleSavePackage = async () => {
    if (!user || packageSaving) return
    const current = packages[0]
    const items = normalizePackageItems(current).map(item => ({
      id: item.id,
      name: item.name.trim(),
      imageUrl: item.imageUrl || null,
    }))
    if (items.length === 0) {
      openAlert({ title: 'Add an Inclusion', message: 'Add at least one item to your package.', tone: 'warning', okLabel: 'Got It' })
      return
    }
    if (items.some(item => !item.name)) {
      openAlert({ title: 'Name Required', message: 'Give every package item a name.', tone: 'warning', okLabel: 'Got It' })
      return
    }
    const missingPhoto = items.find(item => !item.imageUrl)
    if (missingPhoto) {
      openAlert({ title: 'Picture Required', message: `Add a picture for ${missingPhoto.name}.`, tone: 'warning', okLabel: 'Got It' })
      return
    }

    setPackageSaving(true)
    try {
      const payload: ShopPackage = {
        id: current.id,
        shopId: user.id,
        items,
        active: true,
        updatedAt: new Date().toISOString(),
      }
      const { error } = await supabase.from('funeral_shop_packages').upsert(payload, { onConflict: 'shopId' })
      if (error) throw error
      await loadData()
      openAlert({ title: 'Package Saved', message: 'Your package will appear automatically on your products.', tone: 'info', okLabel: 'Done' })
    } catch (err: any) {
      openAlert({ title: 'Save Failed', message: err?.message || 'Unable to save this package.', tone: 'danger', okLabel: 'Dismiss' })
    } finally {
      setPackageSaving(false)
    }
  }

  useEffect(() => {
    let mounted = true
    void supabase.auth.getSession()
      .then(({ data }) => {
        if (!mounted) return
        setUser(data.session?.user ?? null)
        if (!data.session?.user) setLoading(false)
      })
      .catch(() => {
        if (!mounted) return
        setUser(null)
        setLoading(false)
        setError('Your session could not be checked. Refresh the page and try again.')
      })
      .finally(() => {
        if (mounted) setAuthReady(true)
      })
    const { data: l } = supabase.auth.onAuthStateChange((_, s) => {
      if (!mounted) return
      setUser(s?.user ?? null)
      setAuthReady(true)
      if (!s?.user) setLoading(false)
    })
    return () => {
      mounted = false
      l.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!authReady || !user || !loading) return
    const timeout = window.setTimeout(() => {
      setLoading(false)
      setError('The Shop Centre is taking too long to load. Check your connection, then retry.')
    }, 20_000)
    return () => window.clearTimeout(timeout)
  }, [authReady, loading, user])

  useEffect(() => {
    if (!user) return
    let active = true
    const load = async () => {
      try {
        const list = await fetchNotificationsForUser(user.id)
        if (active) setNotifications(list as SellerNotification[])
      } catch {
        // Ignore notification load errors.
      }
    }

    void load()
    const channel = supabase
      .channel(`seller-centre-notifications-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => {
        void load()
      })
      .subscribe()

    return () => {
      active = false
      void supabase.removeChannel(channel)
    }
  }, [user])

  const unreadCount = useMemo(() => notifications.filter((item) => !item.read).length, [notifications])

  const handleNotificationClick = async (item: SellerNotification) => {
    if (!item.read) {
      setNotifications(current => current.map(n => n.id === item.id ? { ...n, read: true } : n))
      await supabase.from('notifications').update({ read: true }).eq('id', item.id)
    }
    setNotificationsOpen(false)
    if (item.type === 'funeral_request_pending') {
      setActiveTab('orders')
    } else {
      navigate('/user/notifications')
    }
  }

  const loadData = useCallback(async () => {
    if (!user) return
    if (!shop) {
      setLoading(true)
    }
    setError(null)
    try {
      const { data: shopData, error: shopErr } = await supabase
        .from('funeral_shops')
        .select('*')
        .eq('id', user.id)
        .maybeSingle()
      if (shopErr) throw shopErr

      setShop(shopData ?? null)
      if (shopData) {
        setShopProfileDraft({
          name: String(shopData.shopName || ''),
          address: String(shopData.shopAddress || ''),
          phone: String(shopData.shopPhoneNumber || ''),
          capacity: String(Math.max(1, Number(shopData.serviceCapacity) || 1)),
        })
      }
      setPayoutDraft({
        channel: String(shopData?.payoutChannelCode || ''),
        name: String(shopData?.payoutAccountName || ''),
        number: String(shopData?.payoutAccountNumber || ''),
      })
      const { data: payoutAccountData, error: payoutAccountError } = await supabase
        .from('funeral_shop_payout_accounts')
        .select('id, "shopId", "channelCode", "accountName", "accountNumber", active, "verifiedByAdmin", "verifiedAt", "createdAt", "updatedAt"')
        .eq('shopId', user.id)
        .order('createdAt', { ascending: true })
      if (payoutAccountError) throw payoutAccountError
      setPayoutAccounts(((payoutAccountData || []) as ShopPayoutAccount[]).filter(account =>
        SHOP_PAYOUT_CHANNELS.some(channel => channel.value === account.channelCode)
      ))

      const { data: paymentData } = await supabase
        .from('shop_payments')
        .select('id, status, amount, "createdAt", "verifiedAt", "expiresAt"')
        .eq('shopId', user.id)
        .order('createdAt', { ascending: false })
        .limit(1)
        .maybeSingle()
      setPayment((paymentData as ShopPayment | null) ?? null)

      const { data: productsData, error: productsErr } = await supabase
        .from('funeral_products')
        .select(`
          id, name, description, price, stock, "imageUrl", active, "hasVariations", "createdAt", "updatedAt",
          funeral_product_variations ( id )
        `)
        .eq('shopId', user.id)
        .order('createdAt', { ascending: false })
      if (productsErr) throw productsErr

      const prods: ShopProduct[] = (productsData ?? []).map((row: any) => ({
        id: String(row.id),
        name: String(row.name ?? 'Untitled'),
        description: String(row.description ?? ''),
        price: Number(row.price) || 0,
        stock: Number(row.stock) || 0,
        imageUrl: row.imageUrl ?? null,
        active: Boolean(row.active),
        hasVariations:
          Boolean(row.hasVariations) || (row.funeral_product_variations ?? []).length > 0,
        variationCount: (row.funeral_product_variations ?? []).length,
        createdAt: row.createdAt ?? '',
        updatedAt: row.updatedAt ?? '',
      }))
      setProducts(prods)

      const { data: packagesData, error: packagesErr } = await supabase
        .from('funeral_shop_packages')
        .select('id, "shopId", items, "flowersImageUrl", "candlesImageUrl", "curtainsImageUrl", "vehicleImageUrl", active, "createdAt", "updatedAt"')
        .eq('shopId', user.id)
        .maybeSingle()
      if (packagesErr) throw packagesErr
      setPackages(packagesData ? [{
        id: String((packagesData as any).id),
        shopId: String((packagesData as any).shopId || user.id),
        items: normalizePackageItems(packagesData as ShopPackage),
        flowersImageUrl: (packagesData as any).flowersImageUrl ?? null,
        candlesImageUrl: (packagesData as any).candlesImageUrl ?? null,
        curtainsImageUrl: (packagesData as any).curtainsImageUrl ?? null,
        vehicleImageUrl: (packagesData as any).vehicleImageUrl ?? null,
        active: Boolean((packagesData as any).active),
        createdAt: (packagesData as any).createdAt ?? null,
        updatedAt: (packagesData as any).updatedAt ?? null,
      }] : [])

      const [reqData] = await Promise.all([
        supabase
          .from('funeral_service_requests')
          .select('*')
          .eq('shopId', user.id)
          .order('createdAt', { ascending: false })
          .limit(250),
      ])

      const reqs = dedupeServiceRequests((reqData?.data ?? []) as ServiceRequest[])
      setRequests(reqs)
      setError(null)

    } catch (e: any) {
      setError(e?.message ?? 'Unable to load shop data.')
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => { if (user?.id) void loadData() }, [user?.id, loadData])

  const openProductDetail = useCallback(async (product: ShopProduct) => {
    setSelectedProduct(product)
    setDetailData(null)
    setDetailError(null)
    setDetailLoading(true)
    setGalleryIndex(0)
    try {
      const [variationsRes, imagesRes, ratingsRes, feedbackRes, feedbackCountRes] = await Promise.all([
        supabase
          .from('funeral_product_variations')
          .select('id, name, price, "imageUrl"')
          .eq('productId', product.id)
          .order('name'),
        supabase
          .from('funeral_product_images')
          .select('id, "imageUrl", "displayOrder"')
          .eq('productId', product.id)
          .order('displayOrder'),
        supabase
          .from('funeral_product_ratings')
          .select('rating')
          .eq('productId', product.id),
        supabase
          .from('funeral_product_feedback')
          .select('id, "displayName", "userEmail", feedback, "ratingSnapshot", "createdAt"')
          .eq('productId', product.id)
          .order('createdAt', { ascending: false })
          .limit(20),
        supabase
          .from('funeral_product_feedback')
          .select('id', { count: 'exact', head: true })
          .eq('productId', product.id),
      ])
      if (variationsRes.error) throw variationsRes.error
      if (imagesRes.error) throw imagesRes.error
      if (ratingsRes.error) throw ratingsRes.error
      if (feedbackRes.error) throw feedbackRes.error
      if (feedbackCountRes.error) throw feedbackCountRes.error

      const ratingRows = (ratingsRes.data || []) as { rating: number }[]
      const totalRating = ratingRows.reduce((sum, row) => sum + (Number(row.rating) || 0), 0)
      const averageRating = ratingRows.length ? totalRating / ratingRows.length : 0

      setDetailData({
        variations: (variationsRes.data || []).map((v: any) => ({
          id: String(v.id),
          name: String(v.name),
          price: v.price == null ? null : Number(v.price),
          imageUrl: v.imageUrl ?? null,
        })),
        images: (imagesRes.data || []).map((img: any) => ({
          id: String(img.id),
          imageUrl: img.imageUrl ?? null,
          displayOrder: Number(img.displayOrder) || 0,
        })),
        ratingCount: ratingRows.length,
        averageRating,
        feedbackCount: feedbackCountRes.count ?? (feedbackRes.data || []).length,
        feedbacks: (feedbackRes.data || []).map((fb: any) => ({
          id: String(fb.id),
          displayName: fb.displayName ?? null,
          userEmail: fb.userEmail ?? null,
          feedback: String(fb.feedback ?? ''),
          ratingSnapshot: fb.ratingSnapshot ?? null,
          createdAt: fb.createdAt ?? null,
        })),
      })
    } catch (e: any) {
      setDetailError(e?.message ?? 'Unable to load product details.')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const handleToggleProduct = (product: ShopProduct) => {
    if (product.active) {
      openConfirm({
        title: 'Pause Product',
        message: `Pause "${product.name}"? It will be hidden from buyers until you activate it again.`,
        confirmLabel: 'Pause Product',
        cancelLabel: 'Cancel',
        tone: 'warning',
        onConfirm: () => void performToggleProduct(product),
      })
      return
    }
    void performToggleProduct(product)
  }

  const performToggleProduct = async (product: ShopProduct) => {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('funeral_products')
        .update({ active: !product.active, updatedAt: new Date().toISOString() })
        .eq('id', product.id)
      if (error) throw error
      await loadData()
    } finally {
      setSaving(false)
    }
  }

  const paymentVerified = payment?.status === 'verified'
  const shopAccountApproved = ['verified', 'live', 'offline'].includes(String(shop?.status || '').toLowerCase())
  const selectedPayoutChannel = SHOP_PAYOUT_CHANNELS.find(channel => channel.value === payoutDraft.channel)

  const paidUntil = shop?.paidUntil ? new Date(shop.paidUntil) : null
  const subscriptionActive = Boolean(paidUntil && paidUntil.getTime() > Date.now())
  const renewalPaymentReady = Boolean(
    paymentVerified
    && payment?.verifiedAt
    && paidUntil
    && new Date(payment.verifiedAt).getTime() > paidUntil.getTime(),
  )
  const subscriptionExpired = Boolean(paymentVerified && paidUntil && paidUntil.getTime() <= Date.now() && !renewalPaymentReady)
  const daysLeft = daysRemaining(shop?.paidUntil)

  const openAdminPayments = () => {
    setSidebarExpanded(prev => ({ ...prev, finance: true }))
    setActiveTab('admin_payments')
  }

  const handleGoLive = () => {
    const currentShop = shop
    if (!currentShop || currentShop.status === 'live' || saving) return

    if (!subscriptionActive && !paymentVerified) {
      openAdminPayments()
      return
    }

    if (subscriptionExpired) {
      openAlert({
        title: 'Subscription Expired',
        message: 'Your subscription expired on ' + formatSubscriptionDate(shop?.paidUntil) + '. Renew your registration payment to go live again.',
        tone: 'warning',
        okLabel: 'Renew Payment',
        onClose: openAdminPayments,
      })
      return
    }

    const now = new Date()
    const currentPaidUntil = currentShop.paidUntil ? new Date(currentShop.paidUntil) : null
    const startsFreshWindow = !currentPaidUntil || currentPaidUntil.getTime() <= now.getTime()
    const goLivePaidUntil = startsFreshWindow ? addMonths(now, SUBSCRIPTION_MONTHS).toISOString() : currentShop.paidUntil

    openConfirm({
      title: 'Go Live?',
      message: 'Activate your shop so buyers can see and order from it.',
      details: [
        'Your shop stays live until your subscription ends on ' + formatSubscriptionDate(goLivePaidUntil) + '.',
        'While live, buyers can browse your products, place orders, and send service requests.',
        'After your subscription ends, your shop automatically goes offline until you renew.',
        'You can take your shop offline anytime without losing your subscription time.',
      ],
      confirmLabel: 'Go Live',
      cancelLabel: 'Cancel',
      tone: 'success',
      onConfirm: async () => {
        setSaving(true)
        try {
          const { error } = await supabase
            .from('funeral_shops')
            .update({ status: 'live', paidUntil: goLivePaidUntil, updatedAt: new Date().toISOString() })
            .eq('id', currentShop.id)
          if (error) throw error
          setShop(prev => (prev ? { ...prev, status: 'live', paidUntil: goLivePaidUntil } : prev))
          openAlert({
            title: 'Your Shop is Live',
            message: 'Congratulations! Your shop is now live and visible to buyers until ' + formatSubscriptionDate(goLivePaidUntil) + '. Share your shop with buyers to start receiving orders.',
            tone: 'info',
            okLabel: 'Done',
          })
        } catch (err: any) {
          openAlert({
            title: 'Action Failed',
            message: 'Unable to go live: ' + (err?.message || 'Unknown error.'),
            tone: 'danger',
            okLabel: 'Dismiss',
          })
        } finally {
          setSaving(false)
        }
      },
    })
  }

  const handleGoOffline = () => {
    if (shop?.status !== 'live' || saving) return
    openConfirm({
      title: 'Take shop offline',
      message: 'Customers will no longer see your shop or products until you go online again.',
      details: [
        'Existing orders will continue as usual.',
        'Your subscription remains active until ' + formatSubscriptionDate(shop.paidUntil) + '.',
      ],
      confirmLabel: 'Go offline',
      cancelLabel: 'Cancel',
      tone: 'warning',
      onConfirm: async () => {
        setSaving(true)
        try {
          const { error } = await supabase
            .from('funeral_shops')
            .update({ status: 'offline', updatedAt: new Date().toISOString() })
            .eq('id', shop.id)
          if (error) throw error
          setShop(prev => (prev ? { ...prev, status: 'offline' } : prev))
          openAlert({
            title: 'Shop is Offline',
            message: 'Your shop is now hidden from buyers. You can go live again anytime before your subscription ends on ' + formatSubscriptionDate(shop.paidUntil) + '.',
            tone: 'info',
            okLabel: 'Done',
          })
        } catch (err: any) {
          openAlert({
            title: 'Action Failed',
            message: 'Unable to go offline: ' + (err?.message || 'Unknown error.'),
            tone: 'danger',
            okLabel: 'Dismiss',
          })
        } finally {
          setSaving(false)
        }
      },
    })
  }

  const handleDeleteProduct = async (product: ShopProduct) => {
    openConfirm({
      title: 'Delete Product',
      message: `Delete "${product.name}"?`,
      details: [
        'This removes the product from your shop immediately.',
        'Buyers will no longer be able to view or order it.',
        'This action cannot be undone.',
      ],
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: async () => {
        setSaving(true)
        try {
          const { error } = await supabase
            .from('funeral_products')
            .delete()
            .eq('id', product.id)
          if (error) throw error
          await loadData()
        } finally {
          setSaving(false)
        }
      },
    })
  }

  const handleUpdateStatus = async (request: ServiceRequest, nextStatus: 'accepted_by_shop' | 'declined_by_shop') => {
    const accepting = nextStatus === 'accepted_by_shop'
    const customRequest = isCustomCasketRequest(request)
    const requestProductPrice = Number(request.productPrice) || 0
    const customPrice = parseCustomCasketPrice(customPriceDrafts[request.id])
    const finalAmount = customRequest ? customPrice : requestProductPrice

    if (accepting && finalAmount <= 0) {
      openAlert({
        title: customRequest ? 'Custom Casket Price Required' : 'Product Price Required',
        message: customRequest
          ? 'Enter the agreed custom casket price. It will only be saved when you accept the request, then the customer can pay.'
          : 'Set the product price before accepting this request.',
        tone: 'warning',
        okLabel: 'Got It',
      })
      return
    }

    openConfirm({
      title: nextStatus === 'accepted_by_shop' ? 'Accept Request' : 'Decline Request',
      message: `Are you sure you want to ${nextStatus === 'accepted_by_shop' ? 'accept' : 'decline'} this request?`,
      details: nextStatus === 'accepted_by_shop'
        ? [
            `Payment amount: ${formatPeso(finalAmount)}. The customer can complete payment securely via Xendit.`,
            request.productId !== 'custom_casket_design'
              ? 'If this is a product order, its stock will be reduced by 1.'
              : 'This is a custom casket design request — no stock will be deducted.',
          ]
        : [
            'The buyer will be notified that you declined their request.',
            'No stock will be deducted.',
          ],
      confirmLabel: nextStatus === 'accepted_by_shop' ? 'Accept' : 'Decline',
      cancelLabel: 'Cancel',
      tone: nextStatus === 'accepted_by_shop' ? 'primary' : 'danger',
      onConfirm: async () => {
        setSaving(true)
        try {
          if (accepting) {
            await acceptFuneralServiceRequest(request.id, customRequest ? finalAmount : undefined)
            setCustomPriceDrafts(current => {
              const next = { ...current }
              delete next[request.id]
              return next
            })
          } else {
            const respondedAt = new Date().toISOString()
            const { error } = await supabase
              .from('funeral_service_requests')
              .update({
                status: 'declined_by_shop',
                declinedAt: respondedAt,
                shopRespondedAt: respondedAt,
                updatedAt: respondedAt,
              })
              .eq('id', request.id)
              .eq('status', 'pending_shop_acceptance')
            if (error) throw error
          }

          try {
            await supabase.from('notifications').insert({
              userId: request.requesterId,
              type: accepting ? 'funeral_payment_ready' : 'funeral_request_updated',
              title: accepting ? 'Request Accepted - Payment Ready' : 'Request Declined',
              body:
                accepting
                  ? (shop?.shopName || 'The shop') + ' accepted your request. Please pay ' + formatPeso(finalAmount) + ' using the checkout now available in your request.'
                  : `${request.productName || 'The shop'} declined your service request.`,
              data: { requestId: request.id, shopId: user?.id },
              read: false,
            })
          } catch {
            // Notification failure is non-blocking.
          }

          await loadData()
        } catch (e: any) {
          openAlert({ title: 'Update Failed', message: "Error updating request: " + e.message, tone: 'danger', okLabel: 'Dismiss' })
        } finally {
          setSaving(false)
        }
      },
    })
  }

  const handleVerifyPayment = async (request: ServiceRequest, outcome: 'verified' | 'rejected') => {
    if (!user || paymentVerifyingId) return
    let rejectionReason = ''
    if (outcome === 'rejected') {
      const enteredReason = window.prompt('Why was this payment rejected? The buyer will see this reason.')
      if (enteredReason === null) return
      rejectionReason = enteredReason.trim()
      if (!rejectionReason) {
        openAlert({ title: 'Reason Required', message: 'Enter a reason so the buyer knows what to correct.', tone: 'warning', okLabel: 'Got It' })
        return
      }
    }

    setPaymentVerifyingId(request.id)
    try {
      const { error } = await supabase
        .from('funeral_service_requests')
        .update(
          outcome === 'verified'
            ? {
                status: 'payment_verified',
                paymentVerifiedAt: new Date().toISOString(),
                paymentRejectionReason: null,
                updatedAt: new Date().toISOString(),
              }
            : {
                status: 'awaiting_payment',
                paymentVerifiedAt: null,
                paymentRejectionReason: rejectionReason,
                updatedAt: new Date().toISOString(),
              }
        )
        .eq('id', request.id)
        .eq('status', 'payment_submitted')
      if (error) throw error

      try {
        await supabase.from('notifications').insert({
          userId: request.requesterId,
          type: 'funeral_payment_updated',
          title: outcome === 'verified' ? 'Payment Verified' : 'Payment Needs Review',
          body:
            outcome === 'verified'
              ? 'The shop verified your payment for your service request. Thank you!'
              : 'The shop could not verify your payment: ' + rejectionReason + '. Please correct it and resubmit.',
          data: { requestId: request.id, shopId: user.id },
          read: false,
        })
      } catch {
        // Notification failure is non-blocking.
      }

      await loadData()
      openAlert({
        title: outcome === 'verified' ? 'Payment Verified' : 'Payment Rejected',
        message:
          outcome === 'verified'
            ? 'The payment has been marked as verified. The requester will be notified.'
            : 'The payment has been marked as rejected. The requester will be notified to resubmit.',
        tone: 'info',
        okLabel: 'Done',
      })
    } catch (e: any) {
      openAlert({ title: 'Update Failed', message: 'Error updating payment: ' + e.message, tone: 'danger', okLabel: 'Dismiss' })
    } finally {
      setPaymentVerifyingId('')
    }
  }

  const handleMarkCompleted = async (request: ServiceRequest) => {
    if (!user || saving) return
    if (!completionProofFile) {
      openAlert({ title: 'Proof Required', message: 'Attach a completion proof photo before marking this request as completed.', tone: 'warning', okLabel: 'Got It' })
      return
    }
    setSaving(true)
    setUploadingCompletionProof(true)
    try {
      let completionProofUrl = ''
      const ext = completionProofFile.name.split('.').pop() || 'jpg'
      const path = `completion-proof/request_${request.id}_${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage.from('avatars').upload(path, completionProofFile, { upsert: true })
      if (uploadError) throw uploadError
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
      completionProofUrl = urlData.publicUrl

      const { error } = await supabase
        .from('funeral_service_requests')
        .update({
          status: 'awaiting_customer_confirmation',
          completionProofImageUrl: completionProofUrl,
          shopMarkedCompletedAt: new Date().toISOString(),
          completedAt: null,
          updatedAt: new Date().toISOString(),
        })
        .eq('id', request.id)
        .eq('status', 'payment_verified')
      if (error) throw error

      try {
        await supabase.from('notifications').insert({
          userId: request.requesterId,
          type: 'funeral_request_completed',
          title: 'Review Your Completion',
          body: `${shop?.shopName || 'The shop'} marked your request as delivered and attached a completion proof. Review it and confirm the request as done.`,
          data: { requestId: request.id, shopId: user.id },
          read: false,
        })
      } catch {
        // Notification failure is non-blocking.
      }

      await loadData()
      clearCompletionProofSelection()
      openAlert({
        title: 'Sent for Confirmation',
        message: 'The request has been marked as delivered. The family will review your completion proof and confirm it as done.',
        tone: 'info',
        okLabel: 'Done',
      })
    } catch (e: any) {
      openAlert({ title: 'Update Failed', message: "Error completing request: " + e.message, tone: 'danger', okLabel: 'Dismiss' })
    } finally {
      setUploadingCompletionProof(false)
      setSaving(false)
    }
  }

  const stats = useMemo(() => ({
    soldOutProducts: products.filter(p => !p.active || p.stock <= 0).length,
    lowStockProducts: products.filter(p => p.active && p.stock > 0 && p.stock <= 3).length,
    liveProducts: products.filter(p => p.active && p.stock > 0).length,
    newRequests: requests.filter(r => String(r.status || '').toLowerCase() === 'pending_shop_acceptance').length,
    unpaidOrders: requests.filter(r => String(r.status || '').toLowerCase() === 'awaiting_payment').length,
    paymentsToVerify: requests.filter(r => String(r.status || '').toLowerCase() === 'payment_submitted').length,
    toProcessShipment: requests.filter(r => r.status === 'payment_verified').length,
    awaitingFamilyConfirmation: requests.filter(r => r.status === 'awaiting_customer_confirmation').length,
    activeCases: requests.filter(r => !['completed', 'declined_by_shop', 'cancelled', 'cancelled_by_requester'].includes(String(r.status || '').toLowerCase())).length,
    processedShipment: requests.filter(r => r.status === 'completed').length,
  }), [products, requests])

  const customers = useMemo<CustomerSummary[]>(() => {
    const terminalStatuses = new Set(['completed', 'declined_by_shop', 'cancelled', 'cancelled_by_requester'])
    const byCustomer = new Map<string, CustomerSummary>()

    requests.forEach((request) => {
      const customerId = String(request.requesterId || request.contactNumber || request.id)
      const existing = byCustomer.get(customerId)
      const requestValue = Number(request.paymentAmount ?? request.productPrice) || 0
      const activity = request.completedAt || request.paymentVerifiedAt || request.acceptedAt || request.createdAt || null
      const status = String(request.status || '').toLowerCase()
      const name = request.requesterName || request.familyCoordinatorName || request.paymentPayerName || `Customer ${customerId.slice(0, 8)}`

      if (!existing) {
        byCustomer.set(customerId, {
          id: customerId,
          name,
          contactNumber: request.contactNumber || '',
          arrangements: [request],
          activeCount: terminalStatuses.has(status) ? 0 : 1,
          completedCount: status === 'completed' ? 1 : 0,
          totalValue: ['payment_verified', 'awaiting_customer_confirmation', 'completed'].includes(status) ? requestValue : 0,
          lastActivity: activity,
        })
        return
      }

      existing.arrangements.push(request)
      if (!existing.contactNumber && request.contactNumber) existing.contactNumber = request.contactNumber
      if (!terminalStatuses.has(status)) existing.activeCount += 1
      if (status === 'completed') existing.completedCount += 1
      if (['payment_verified', 'awaiting_customer_confirmation', 'completed'].includes(status)) existing.totalValue += requestValue
      if (activity && (!existing.lastActivity || new Date(activity).getTime() > new Date(existing.lastActivity).getTime())) {
        existing.lastActivity = activity
      }
    })

    return [...byCustomer.values()].sort((a, b) =>
      new Date(b.lastActivity || 0).getTime() - new Date(a.lastActivity || 0).getTime()
    )
  }, [requests])

  const visibleCustomers = useMemo(() => {
    const query = customerSearch.trim().toLowerCase()
    if (!query) return customers
    return customers.filter((customer) =>
      [customer.name, customer.contactNumber, customer.id].some((value) => value.toLowerCase().includes(query))
    )
  }, [customerSearch, customers])

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === selectedCustomerId) || null,
    [customers, selectedCustomerId]
  )

  const scheduledRequests = useMemo(
    () => requests
      .filter((request) => request.wakeStartDate || request.wakeEndDate || request.burialTime)
      .sort((a, b) => {
        const left = new Date(a.wakeStartDate || a.wakeEndDate || a.createdAt || 0).getTime()
        const right = new Date(b.wakeStartDate || b.wakeEndDate || b.createdAt || 0).getTime()
        return left - right
      }),
    [requests]
  )

  const upcomingRequests = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return scheduledRequests
      .filter((request) => {
        const scheduleDate = request.wakeStartDate || request.wakeEndDate
        if (!scheduleDate) return false
        const parsed = new Date(scheduleDate)
        return !Number.isNaN(parsed.getTime()) && parsed.getTime() >= today.getTime()
      })
      .slice(0, 4)
  }, [scheduledRequests])

  const scheduleCalendarDays = useMemo(() => buildScheduleCalendarDays(scheduleMonth), [scheduleMonth])

  const loadShopSchedule = useCallback(async () => {
    if (!shop?.id) return
    setScheduleLoading(true)
    setScheduleError(null)
    try {
      const firstDate = toScheduleDateKey(scheduleCalendarDays[0])
      const lastDate = toScheduleDateKey(scheduleCalendarDays[scheduleCalendarDays.length - 1])
      const events = await listShopScheduleEvents(shop.id, firstDate, lastDate)
      setShopScheduleEvents(events)
    } catch (scheduleLoadError: any) {
      setScheduleError(scheduleLoadError?.message || 'Could not load the schedule.')
    } finally {
      setScheduleLoading(false)
    }
  }, [scheduleCalendarDays, shop?.id])

  useEffect(() => {
    if (activeTab === 'calendar') void loadShopSchedule()
  }, [activeTab, loadShopSchedule])

  const requestScheduleItems = useMemo(() => buildRequestScheduleItems(scheduledRequests), [scheduledRequests])
  const combinedScheduleItems = useMemo(() =>
    [...requestScheduleItems, ...shopScheduleEvents.map(buildShopScheduleItem)].sort((left, right) =>
      left.dateKey.localeCompare(right.dateKey) || left.timeSort.localeCompare(right.timeSort)
    ), [requestScheduleItems, shopScheduleEvents])
  const allScheduleItems = useMemo(() => combinedScheduleItems.filter(item =>
    scheduleFilter === 'all'
    || (scheduleFilter === 'requests' && item.source === 'request')
    || (scheduleFilter === 'shop' && item.source === 'shop')
  ), [combinedScheduleItems, scheduleFilter])

  const scheduleItemsByDate = useMemo(() => {
    const grouped: Record<string, ScheduleItem[]> = {}
    allScheduleItems.forEach(item => {
      if (!grouped[item.dateKey]) grouped[item.dateKey] = []
      grouped[item.dateKey].push(item)
    })
    return grouped
  }, [allScheduleItems])

  const selectedScheduleItems = scheduleItemsByDate[selectedScheduleDate] || []
  const scheduleTodayKey = toScheduleDateKey(new Date())
  const scheduleNextWeek = useMemo(() => {
    const end = new Date()
    end.setDate(end.getDate() + 7)
    const endKey = toScheduleDateKey(end)
    return combinedScheduleItems.filter(item => item.dateKey >= scheduleTodayKey && item.dateKey <= endKey).length
  }, [combinedScheduleItems, scheduleTodayKey])

  const openNewScheduleEvent = (date = selectedScheduleDate) => {
    setEditingScheduleEvent(null)
    setScheduleDraft({ ...EMPTY_SCHEDULE_DRAFT, eventDate: date })
    setScheduleModalOpen(true)
  }

  const openScheduleEvent = (event: ShopScheduleEvent) => {
    setEditingScheduleEvent(event)
    setScheduleDraft({
      title: event.title,
      eventType: event.event_type,
      eventDate: event.event_date,
      startTime: event.start_time?.slice(0, 5) || '09:00',
      endTime: event.end_time?.slice(0, 5) || '',
      location: event.location || '',
      notes: event.notes || '',
    })
    setScheduleModalOpen(true)
  }

  const saveScheduleEvent = async () => {
    if (!shop?.id || savingScheduleEvent) return
    const title = scheduleDraft.title.trim()
    if (!title || !scheduleDraft.eventDate) {
      openAlert({ title: 'Missing information', message: 'Enter a title and date.', tone: 'warning', okLabel: 'Done' })
      return
    }
    if (scheduleDraft.endTime && scheduleDraft.startTime && scheduleDraft.endTime <= scheduleDraft.startTime) {
      openAlert({ title: 'Check the time', message: 'The end time must be later than the start time.', tone: 'warning', okLabel: 'Done' })
      return
    }

    const input: ShopScheduleEventInput = {
      title,
      eventType: scheduleDraft.eventType,
      eventDate: scheduleDraft.eventDate,
      startTime: scheduleDraft.startTime,
      endTime: scheduleDraft.endTime,
      location: scheduleDraft.location,
      notes: scheduleDraft.notes,
    }

    setSavingScheduleEvent(true)
    try {
      if (editingScheduleEvent) await updateShopScheduleEvent(editingScheduleEvent.id, input)
      else await createShopScheduleEvent(shop.id, input)
      setScheduleModalOpen(false)
      setEditingScheduleEvent(null)
      setSelectedScheduleDate(scheduleDraft.eventDate)
      const savedDate = scheduleDateFromKey(scheduleDraft.eventDate)
      if (savedDate) setScheduleMonth(new Date(savedDate.getFullYear(), savedDate.getMonth(), 1))
      await loadShopSchedule()
    } catch (scheduleSaveError: any) {
      openAlert({ title: 'Event not saved', message: scheduleSaveError?.message || 'Could not save the event.', tone: 'danger', okLabel: 'Dismiss' })
    } finally {
      setSavingScheduleEvent(false)
    }
  }

  const removeScheduleEvent = () => {
    if (!editingScheduleEvent || savingScheduleEvent) return
    const event = editingScheduleEvent
    openConfirm({
      title: 'Delete schedule event?',
      message: `Remove “${event.title}” from the shop schedule?`,
      confirmLabel: 'Delete event',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: async () => {
        setSavingScheduleEvent(true)
        try {
          await deleteShopScheduleEvent(event.id)
          setScheduleModalOpen(false)
          setEditingScheduleEvent(null)
          await loadShopSchedule()
        } catch (scheduleDeleteError: any) {
          openAlert({ title: 'Event not deleted', message: scheduleDeleteError?.message || 'Could not delete the event.', tone: 'danger', okLabel: 'Dismiss' })
        } finally {
          setSavingScheduleEvent(false)
        }
      },
    })
  }

  const recentRequests = useMemo(
    () => [...requests]
      .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime())
      .slice(0, 5),
    [requests]
  )

  const report = useMemo(() => {
    const successfulStatuses = new Set(['payment_verified', 'awaiting_customer_confirmation', 'completed'])
    const acceptedStatuses = new Set(['accepted_by_shop', 'awaiting_payment', 'payment_submitted', ...successfulStatuses])
    const monthly = Array.from({ length: 6 }, (_, index) => {
      const date = new Date()
      date.setMonth(date.getMonth() - (5 - index), 1)
      date.setHours(0, 0, 0, 0)
      return {
        key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
        label: date.toLocaleDateString('en-PH', { month: 'short' }),
        cases: 0,
        revenue: 0,
      }
    })

    let revenue = 0
    let completed = 0
    let accepted = 0
    requests.forEach((request) => {
      const status = String(request.status || '').toLowerCase()
      const amount = Number(request.paymentAmount ?? request.productPrice) || 0
      if (successfulStatuses.has(status)) revenue += amount
      if (status === 'completed') completed += 1
      if (acceptedStatuses.has(status)) accepted += 1
      const createdAt = request.createdAt ? new Date(request.createdAt) : null
      if (!createdAt || Number.isNaN(createdAt.getTime())) return
      const key = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}`
      const bucket = monthly.find((entry) => entry.key === key)
      if (!bucket) return
      bucket.cases += 1
      if (successfulStatuses.has(status)) bucket.revenue += amount
    })

    return {
      revenue,
      completed,
      accepted,
      conversionRate: requests.length ? Math.round((accepted / requests.length) * 100) : 0,
      averageValue: accepted ? revenue / accepted : 0,
      lowStock: products.filter((product) => product.stock > 0 && product.stock <= 3).length,
      soldOut: products.filter((product) => !product.active || product.stock <= 0).length,
      monthly,
    }
  }, [products, requests])

  const maxMonthlyCases = Math.max(1, ...report.monthly.map((entry) => entry.cases))
  const maxMonthlyRevenue = Math.max(1, ...report.monthly.map((entry) => entry.revenue))

  const statusMeta = shopStatusMeta(shop?.status || 'none', shop?.rejectionReason || null)
  const isShopOnline = shop?.status === 'live'

  const profileReady = Boolean(shop?.shopName && shop.shopAddress && shop.shopPhoneNumber)
  const readinessItems = [
    { label: 'Shop profile', detail: 'Address and contact details', complete: profileReady, tab: 'settings' },
    { label: 'Product catalog', detail: 'At least one available product', complete: stats.liveProducts > 0, tab: 'products' },
    { label: 'Storefront visibility', detail: 'Subscription active and shop online', complete: Boolean(subscriptionActive && isShopOnline), tab: 'admin_payments' },
  ] as const
  const readinessCompleted = readinessItems.filter(item => item.complete).length
  const readinessProgress = Math.round((readinessCompleted / readinessItems.length) * 100)
  const attentionCount = stats.newRequests + stats.paymentsToVerify + stats.toProcessShipment + stats.lowStockProducts + stats.soldOutProducts

  const paymentSubmissions = useMemo(
    () =>
      requests.filter((r) => {
        const status = String(r.status || '').toLowerCase()
        return Boolean(r.paymentProofImageUrl || r.paymentSubmittedAt)
          || ['payment_submitted', 'payment_verified', 'awaiting_customer_confirmation', 'completed'].includes(status)
      }),
    [requests]
  )

  const financeSummary = useMemo(() => {
    const settledStatuses = new Set(['payment_verified', 'awaiting_customer_confirmation', 'completed'])
    return paymentSubmissions.reduce(
      (summary, request) => {
        const status = String(request.status || '').toLowerCase()
        if (status === 'payment_submitted') summary.awaitingReview += 1
        if (settledStatuses.has(status)) {
          summary.verified += 1
          summary.received += Number(request.paymentAmount) || 0
        }
        return summary
      },
      { awaitingReview: 0, verified: 0, received: 0 }
    )
  }, [paymentSubmissions])

  const visibleFamilyPayments = useMemo(() => {
    if (familyPaymentFilter === 'review') {
      return paymentSubmissions.filter(request => String(request.status || '').toLowerCase() === 'payment_submitted')
    }
    if (familyPaymentFilter === 'verified') {
      return paymentSubmissions.filter(request => getFamilyPaymentStatus(request).label === 'Verified')
    }
    return paymentSubmissions
  }, [familyPaymentFilter, paymentSubmissions])

  const customCasketRequests = useMemo(() => requests.filter(isCustomCasketRequest), [requests])
  const visibleArrangementRequests = arrangementFilter === 'custom_casket' ? customCasketRequests : requests

  const filtered = useMemo(() => {
    if (productTab === 'all') return products
    if (productTab === 'live') return products.filter(p => p.active && p.stock > 0)
    return products.filter(p => !p.active || p.stock <= 0)
  }, [products, productTab])

  const shopPackage = packages[0] || null
  const packageItems = normalizePackageItems(shopPackage)

  const galleryImages = useMemo(() => {
    if (!selectedProduct) return []
    const imgs = [
      selectedProduct.imageUrl ?? '',
      ...(detailData?.images ?? []).map((img) => img.imageUrl ?? ''),
    ]
    return [...new Set(imgs.filter((url) => url))]
  }, [selectedProduct, detailData])

  const mainImage = galleryImages[galleryIndex] || selectedProduct?.imageUrl || ''

  const isLoggedIn = Boolean(user)

  if (!authReady || (loading && !shop)) {
    return (
      <div className="sc-page">
        <div className="sc-state">
          <div className="sc-spinner" />
          <p>Loading your shop centre…</p>
        </div>
      </div>
    )
  }

  if (!isLoggedIn) {
    return (
      <div className="sc-page">
        <div className="page-back-row sc-status-page-back">
          <PageBackButton />
        </div>
        <div className="sc-access-denied">
          <div className="sc-access-denied-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0110 0v4"></path>
            </svg>
          </div>
          <h2 className="sc-access-denied-title">Access Denied</h2>
          <p className="sc-access-denied-desc">You need to be logged in as a funeral shop owner to access the Shop Center.</p>
          <div className="sc-access-denied-actions">
            <Link to="/login" className="sc-access-denied-login">Login to Continue</Link>
          </div>
        </div>
      </div>
    )
  }

  if (!loading && !shop) {
    return (
      <div className="sc-page">
        <div className="page-back-row sc-status-page-back">
          <PageBackButton to="/funeral" />
        </div>
        <div className="sc-status-page">
          <h2>No Shop Registered</h2>
          <p>You haven't registered a funeral shop yet. Click below to register your shop and start selling on LifeCycle.</p>
          <div className="sc-status-page-actions">
            <Link to="/seller/register" className="sc-primary-btn">Register Shop</Link>
          </div>
        </div>
      </div>
    )
  }

  if (!loading && shop?.status === 'pending') {
    return (
      <div className="sc-page">
        <div className="page-back-row sc-status-page-back">
          <PageBackButton to="/funeral" />
        </div>
        <div className="sc-status-page">
          <h2>Registration Pending</h2>
          <p>Your shop registration is currently under review. We will notify you once it has been verified.</p>
        </div>
      </div>
    )
  }

  if (!loading && shop?.status === 'rejected') {
    return (
      <div className="sc-page">
        <div className="page-back-row sc-status-page-back">
          <PageBackButton to="/funeral" />
        </div>
        <div className="sc-status-page">
          <h2>Registration Rejected</h2>
          <p>Your shop registration was not approved.</p>
          {shop.rejectionReason && (
            <div className="sc-status-page-error-box">
              <strong>Reason:</strong> {shop.rejectionReason}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (!shop) return null

  return (
    <div className={`sc-page${sidebarOpen ? '' : ' sidebar-collapsed'}`}>
      {/* ── Header Bar ── */}
      <div className="sc-header-bar">
        <div className="sc-header-left">
          <button
            type="button"
            className="sc-mobile-menu-trigger"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation menu"
            aria-haspopup="dialog"
            aria-expanded={mobileNavOpen}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
          <div className="sc-logo-area">
            <BrandLogo to="/funeral" compact />
            <span className="sc-logo-sub">Shop Centre</span>
          </div>
        </div>
        <div className="sc-header-right">
          <div
            className={`sc-header-store-status ${isShopOnline ? 'is-online' : 'is-offline'}`}
            role="status"
            title={statusMeta.message}
          >
            <span className="sc-header-store-status-dot" aria-hidden="true" />
            <span className="sc-header-store-status-copy">
              <span>Store status</span>
              <strong>{isShopOnline ? 'Online' : 'Offline'}</strong>
            </span>
          </div>
          <div className="sc-notif-wrap">
            <button
              type="button"
              className="sc-header-btn sc-notification-button"
              title="Notifications"
              aria-label="Notifications"
              aria-haspopup="dialog"
              aria-expanded={notificationsOpen}
              aria-controls="sc-notification-menu"
              onClick={() => setNotificationsOpen(prev => !prev)}
            >
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" /></svg>
              {unreadCount > 0 ? <span className="sc-notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span> : null}
            </button>

            {notificationsOpen ? (
              <div id="sc-notification-menu" className="sc-notif-dropdown" role="dialog" aria-label="Notifications" aria-modal="false">
                <div className="sc-notif-header">
                  <span>Notifications</span>
                  <button
                    type="button"
                    className="sc-notif-viewall"
                    onClick={() => {
                      setNotificationsOpen(false)
                      navigate('/user/notifications')
                    }}
                  >
                    View All
                  </button>
                </div>
                {notifications.length === 0 ? (
                  <p className="sc-notif-empty">No notifications yet.</p>
                ) : (
                  notifications.slice(0, 8).map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      className={`sc-notif-row${item.read ? '' : ' unread'}`}
                      onClick={() => void handleNotificationClick(item)}
                    >
                      <strong>{item.title || item.type || 'Notification'}</strong>
                      <span>{item.message || item.body || ''}</span>
                      <time>{getTimeLabel(item.createdAt)}</time>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
          <div className="sc-header-divider" />
          <div className="sc-header-user">
            {shop.shopImageUrl ? (
              <img src={shop.shopImageUrl} alt="" className="sc-header-avatar" />
            ) : (
              <span className="sc-header-avatar-ph">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>
              </span>
            )}
            <span className="sc-header-username">{shop.shopName || 'My Shop'}</span>
          </div>
        </div>
      </div>

      {/* ── Workspace (Sidebar + Content) ── */}
      <div className="sc-workspace">
        {mobileNavOpen ? (
          <button
            type="button"
            className="sc-mobile-menu-backdrop"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close navigation menu"
          />
        ) : null}
        <aside
          id="seller-centre-sidebar"
          className={`sc-sidebar${mobileNavOpen ? ' is-mobile-open' : ''}`}
          onClick={(event) => {
            const target = event.target as HTMLElement
            if (target.closest('.sc-sidebar-item, .sc-sidebar-sub-item')) setMobileNavOpen(false)
          }}
          {...(mobileNavOpen ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'Navigation menu' } : {})}
        >
          <div className="sc-mobile-menu-head">
            <span>Menu</span>
            <button type="button" className="sc-mobile-menu-close" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation menu">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </div>
          <div className="sc-mobile-menu-profile">
            {shop.shopImageUrl ? (
              <img src={shop.shopImageUrl} alt="" />
            ) : (
              <span className="sc-mobile-menu-avatar" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></svg>
              </span>
            )}
            <div>
              <strong>{shop.shopName || 'My Shop'}</strong>
              <span>{user?.email}</span>
            </div>
          </div>
          <nav className="sc-sidebar-nav">
            <button
              type="button"
              className="sc-sidebar-toggle sc-sidebar-toggle-row"
              onClick={() => setSidebarOpen((current) => !current)}
              aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
              aria-expanded={sidebarOpen}
              aria-controls="seller-centre-sidebar"
              title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 7H20" />
                <path d="M4 12H20" />
                <path d="M4 17H20" />
              </svg>
              <span className="sc-sidebar-label">Menu</span>
            </button>

            {/* Dashboard */}
            <div className={`sc-sidebar-item${activeTab === 'dashboard' ? ' active' : ''}`} onClick={() => setActiveTab('dashboard')} title="Dashboard">
              <svg className="sc-sidebar-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
              <span className="sc-sidebar-label">Dashboard</span>
            </div>

            <div className={`sc-sidebar-item${activeTab === 'messages' ? ' active' : ''}`} onClick={() => setActiveTab('messages')} title="Messages">
              <svg className="sc-sidebar-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" /></svg>
              <span className="sc-sidebar-label">Messages</span>
            </div>

            {/* Operations Group */}
            <div className="sc-sidebar-group">
              <div className="sc-sidebar-group-header" onClick={() => toggleSidebarGroup('order')} title="Operations">
                <div className="sc-sidebar-group-title">
                  <svg className="sc-sidebar-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                  <span className="sc-sidebar-label">Operations</span>
                </div>
                <svg className={`sc-arrow${sidebarExpanded.order ? ' expanded' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
              </div>
              {sidebarExpanded.order && (
                <div className="sc-sidebar-sub">
                  <div
                    className={`sc-sidebar-sub-item${activeTab === 'orders' && arrangementFilter === 'all' ? ' active' : ''}`}
                    onClick={() => { setArrangementFilter('all'); setActiveTab('orders') }}
                  >Arrangement Cases</div>
                  <div
                    className={`sc-sidebar-sub-item${activeTab === 'orders' && arrangementFilter === 'custom_casket' ? ' active' : ''}`}
                    onClick={() => { setArrangementFilter('custom_casket'); setActiveTab('orders') }}
                  >Custom Casket Requests</div>
                  <div className={`sc-sidebar-sub-item${activeTab === 'customers' ? ' active' : ''}`} onClick={() => setActiveTab('customers')}>Customers</div>
                  <div className={`sc-sidebar-sub-item${activeTab === 'calendar' ? ' active' : ''}`} onClick={() => setActiveTab('calendar')}>Service Schedule</div>
                </div>
              )}
            </div>

            <div className={`sc-sidebar-item${activeTab === 'reports' ? ' active' : ''}`} onClick={() => setActiveTab('reports')} title="Reports">
              <span className='sc-sidebar-icon' aria-hidden='true'>R</span>
              <span className="sc-sidebar-label">Reports</span>
            </div>

            {/* Product Group */}
            <div className="sc-sidebar-group">
              <div className="sc-sidebar-group-header" onClick={() => toggleSidebarGroup('product')} title="Product">
                <div className="sc-sidebar-group-title">
                  <svg className="sc-sidebar-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></svg>
                  <span className="sc-sidebar-label">Product</span>
                </div>
                <svg className={`sc-arrow${sidebarExpanded.product ? ' expanded' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
              </div>
              {sidebarExpanded.product && (
                <div className="sc-sidebar-sub">
                  <div className={`sc-sidebar-sub-item${activeTab === 'products' ? ' active' : ''}`} onClick={() => setActiveTab('products')}>Product Catalog</div>
                  <div className={`sc-sidebar-sub-item${activeTab === 'packages' ? ' active' : ''}`} onClick={() => setActiveTab('packages')}>Packages</div>
                </div>
              )}
            </div>

            {/* Finance Group */}
            <div className="sc-sidebar-group">
              <div className="sc-sidebar-group-header" onClick={() => toggleSidebarGroup('finance')} title="Finance">
                <div className="sc-sidebar-group-title">
                  <svg className="sc-sidebar-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                  <span className="sc-sidebar-label">Finance</span>
                </div>
                <svg className={`sc-arrow${sidebarExpanded.finance ? ' expanded' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
              </div>
              {sidebarExpanded.finance && (
                <div className="sc-sidebar-sub">
                  <div className={`sc-sidebar-sub-item${activeTab === 'payments' ? ' active' : ''}`} onClick={() => setActiveTab('payments')}>Family Payments</div>
                  <div className={`sc-sidebar-sub-item${activeTab === 'payout_accounts' || activeTab === 'payout_account_setup' ? ' active' : ''}`} onClick={() => setActiveTab('payout_accounts')}>Payout Accounts</div>
                  <div className={`sc-sidebar-sub-item${activeTab === 'admin_payments' ? ' active' : ''}`} onClick={openAdminPayments}>LifeCycle Payments</div>
                </div>
              )}
            </div>

            {/* Shop Group */}
            <div className="sc-sidebar-group">
              <div className="sc-sidebar-group-header" onClick={() => toggleSidebarGroup('setting')} title="Shop">
                <div className="sc-sidebar-group-title">
                  <svg className="sc-sidebar-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
                  <span className="sc-sidebar-label">Shop</span>
                </div>
                <svg className={`sc-arrow${sidebarExpanded.setting ? ' expanded' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
              </div>
              {sidebarExpanded.setting && (
                <div className="sc-sidebar-sub">
                  <div
                    className={`sc-sidebar-sub-item${activeTab === 'settings' || activeTab === 'registered_information' ? ' active' : ''}`}
                    onClick={() => navigate('/seller?tab=settings')}
                  >
                    Profile &amp; Settings
                  </div>
                  <div className='sc-sidebar-sub-item' onClick={() => navigate(`/shop/${shop.id}`)}>View Storefront</div>
                  <div className="sc-sidebar-sub-item" onClick={() => navigate('/funeral')}>Return to Marketplace</div>
                </div>
              )}
            </div>
          </nav>
        </aside>

        {/* Content */}
        <main className="sc-content-area">
          {error && (
            <div className="sc-state sc-state-error">
              <p>{error}</p>
              <button className="sc-primary-btn" onClick={() => void loadData()}>Retry</button>
            </div>
          )}

          {!loading && !error && !shop && (
            <div className="sc-state">
              <h2>No Shop Found</h2>
              <p>It looks like you haven't registered a funeral shop yet.</p>
              <Link to="/funeral" className="sc-primary-btn">Go to Marketplace</Link>
            </div>
          )}

          {!loading && !error && shop && (
            <div className="sc-content-grid">
              
              {/* DASHBOARD VIEW */}
              {activeTab === 'dashboard' && (
                <div className="sc-dashboard-overview">
                  {/* Shop dashboard header */}
                  <section className="sc-dashboard-hero">
                    <div className="sc-dashboard-hero-main">
                      <div className="sc-dashboard-hero-avatar-wrap">
                        {shop.shopImageUrl ? (
                          <img
                            src={shop.shopImageUrl}
                            alt={shop.shopName}
                            className="sc-dashboard-hero-avatar"
                          />
                        ) : (
                          <div className="sc-dashboard-hero-avatar-placeholder">
                            {shop.shopName.trim().charAt(0).toUpperCase() || 'S'}
                          </div>
                        )}
                        <span
                          className={`sc-dashboard-hero-avatar-dot ${isShopOnline && subscriptionActive ? 'online' : 'offline'}`}
                          title={isShopOnline && subscriptionActive ? 'Online & Discoverable' : 'Offline'}
                        />
                      </div>

                      <div className="sc-dashboard-hero-details">
                        <div className="sc-dashboard-hero-badges">
                          <span className="sc-dashboard-badge verified">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>
                            Verified
                          </span>
                          {isShopOnline && subscriptionActive ? (
                            <span className="sc-dashboard-badge live">
                              <span className="sc-badge-pulse-dot" />
                              Storefront Active · {daysLeft}d left
                            </span>
                          ) : subscriptionExpired ? (
                            <span className="sc-dashboard-badge warning" onClick={openAdminPayments} style={{ cursor: 'pointer' }}>
                              Subscription Expired · Renew
                            </span>
                          ) : (
                            <span className="sc-dashboard-badge neutral">
                              {statusMeta.label}
                            </span>
                          )}
                        </div>

                        <h1 className="sc-dashboard-hero-title">Dashboard</h1>

                         <div className="sc-dashboard-hero-meta">
                           <span className="sc-dashboard-hero-meta-item sc-dashboard-hero-shopname">
                             <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9h18l-2-6H5L3 9Z"/><path d="M5 9v12h14V9M9 21v-7h6v7"/></svg>
                             {shop.shopName || 'My Shop'}
                           </span>
                           <span className="sc-dashboard-hero-meta-item">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                            {shop.generalLocation || shop.shopAddress || 'Philippines'}
                          </span>
                          {shop.shopPhoneNumber && (
                            <span className="sc-dashboard-hero-meta-item">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                              {shop.shopPhoneNumber}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                  </section>

                  {/* Shop summary */}
                  <section className="sc-dashboard-kpis" aria-label="Shop summary">
                    {/* Revenue Card */}
                    <article className="sc-kpi-card" onClick={() => setActiveTab('reports')} role="button" tabIndex={0}>
                      <div className="sc-kpi-top">
                        <span className="sc-kpi-label">Revenue</span>
                        <div className="sc-kpi-icon-wrap emerald">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
                        </div>
                      </div>
                      <div className="sc-kpi-value">{formatPeso(report.revenue)}</div>
                      <div className="sc-kpi-bottom">
                        <span className="sc-kpi-sub-pill emerald">
                          {report.completed} completed
                        </span>
                        <span className="sc-kpi-sub-text">
                          Avg. {formatPeso(report.averageValue)}
                        </span>
                      </div>
                    </article>

                    {/* Active Cases Card */}
                    <article className="sc-kpi-card" onClick={() => setActiveTab('orders')} role="button" tabIndex={0}>
                      <div className="sc-kpi-top">
                        <span className="sc-kpi-label">Active cases</span>
                        <div className="sc-kpi-icon-wrap blue">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
                        </div>
                      </div>
                      <div className="sc-kpi-value">{stats.activeCases}</div>
                      <div className="sc-kpi-bottom">
                        {stats.awaitingFamilyConfirmation > 0 ? (
                          <span className="sc-kpi-sub-pill amber">
                            {stats.awaitingFamilyConfirmation} awaiting family
                          </span>
                        ) : (
                          <span className="sc-kpi-sub-pill blue">
                            No waiting cases
                          </span>
                        )}
                        <span className="sc-kpi-sub-text">Currently in progress</span>
                      </div>
                    </article>

                    {/* New requests */}
                    <article className="sc-kpi-card" onClick={() => setActiveTab('orders')} role="button" tabIndex={0}>
                      <div className="sc-kpi-top">
                        <span className="sc-kpi-label">New requests</span>
                        <div className="sc-kpi-icon-wrap indigo">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 12h-6l-2 3h-4l-2-3H2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-7z"/><path d="M5.45 5.11L2 12v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-7l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
                        </div>
                      </div>
                      <div className="sc-kpi-value">{stats.newRequests}</div>
                      <div className="sc-kpi-bottom">
                        {stats.newRequests > 0 ? (
                          <span className="sc-kpi-sub-pill crimson">
                            <span className="sc-kpi-dot crimson" /> Action needed
                          </span>
                        ) : (
                          <span className="sc-kpi-sub-pill emerald">
                            ✓ All reviewed
                          </span>
                        )}
                        <span className="sc-kpi-sub-text">{requests.length} total cases</span>
                      </div>
                    </article>

                    {/* Live Catalog Card */}
                    <article className="sc-kpi-card" onClick={() => setActiveTab('products')} role="button" tabIndex={0}>
                      <div className="sc-kpi-top">
                        <span className="sc-kpi-label">Live products</span>
                        <div className="sc-kpi-icon-wrap purple">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m7.5 4.27 9 5.15M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/></svg>
                        </div>
                      </div>
                      <div className="sc-kpi-value">{stats.liveProducts}</div>
                      <div className="sc-kpi-bottom">
                        {stats.lowStockProducts + stats.soldOutProducts > 0 ? (
                          <span className="sc-kpi-sub-pill amber">
                            {stats.lowStockProducts + stats.soldOutProducts} stock alert{stats.lowStockProducts + stats.soldOutProducts === 1 ? '' : 's'}
                          </span>
                        ) : (
                          <span className="sc-kpi-sub-pill emerald">
                            No stock alerts
                          </span>
                        )}
                        <span className="sc-kpi-sub-text">Visible to customers</span>
                      </div>
                    </article>
                  </section>

                 {/* Performance */}
                 <section className="sc-dashboard-panel sc-analytics-panel">
                    <div className="sc-panel-header sc-performance-header">
                     <div>
                        <h2 className="sc-panel-title">Performance</h2>
                        <p className="sc-panel-description">Requests and verified revenue for the last six months.</p>
                     </div>
                      <div className="sc-performance-actions">
                        <span className="sc-performance-rate"><strong>{report.conversionRate}%</strong> acceptance rate</span>
                       <button type="button" className="sc-text-link-btn" onClick={() => setActiveTab('reports')}>
                          View reports
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                        </button>
                      </div>
                    </div>

                    <div className="sc-chart-dual-grid">
                     <article className="sc-chart-card">
                        <div className="sc-chart-card-header">
                          <div>
                            <span className="sc-chart-card-title">Requests</span>
                            <span className="sc-chart-card-subtitle">{report.monthly.reduce((total, entry) => total + entry.cases, 0)} received</span>
                         </div>
                       </div>

                        <div className="sc-chart-plot">
                          <div className="sc-chart-axis" aria-hidden="true">
                            <span>{maxMonthlyCases}</span>
                            <span>{Math.ceil(maxMonthlyCases / 2)}</span>
                            <span>0</span>
                          </div>
                          <div className="sc-chart-visual" role="img" aria-label="Monthly requests received over the last six months">
                            <div className="sc-chart-gridlines" aria-hidden="true">
                              <span /><span /><span />
                            </div>
                            <div className="sc-chart-bars-container">
                              {report.monthly.map((entry) => {
                                const pct = entry.cases ? Math.max(6, Math.round((entry.cases / maxMonthlyCases) * 100)) : 0
                                return (
                                  <div className="sc-chart-bar-col" key={entry.key} aria-label={`${entry.label}: ${entry.cases} requests`}>
                                    <span className="sc-chart-value">{entry.cases}</span>
                                    <div className="sc-chart-bar-track">
                                      <div className={`sc-chart-bar-fill cases ${entry.cases ? '' : 'is-zero'}`} style={{ height: `${pct}%` }} />
                                    </div>
                                    <span className="sc-chart-bar-label">{entry.label}</span>
                                 </div>
                                )
                              })}
                            </div>
                         </div>
                       </div>
                     </article>

                     <article className="sc-chart-card">
                        <div className="sc-chart-card-header">
                          <div>
                            <span className="sc-chart-card-title">Revenue</span>
                            <span className="sc-chart-card-subtitle">{formatCompactPeso(report.revenue)} verified</span>
                         </div>
                       </div>

                        <div className="sc-chart-plot">
                          <div className="sc-chart-axis" aria-hidden="true">
                            <span>{formatCompactPeso(maxMonthlyRevenue)}</span>
                            <span>{formatCompactPeso(maxMonthlyRevenue / 2)}</span>
                            <span>₱0</span>
                          </div>
                          <div className="sc-chart-visual" role="img" aria-label="Monthly verified revenue over the last six months">
                            <div className="sc-chart-gridlines" aria-hidden="true">
                              <span /><span /><span />
                            </div>
                            <div className="sc-chart-bars-container">
                              {report.monthly.map((entry) => {
                                const pct = entry.revenue ? Math.max(6, Math.round((entry.revenue / maxMonthlyRevenue) * 100)) : 0
                                return (
                                  <div className="sc-chart-bar-col" key={entry.key} aria-label={`${entry.label}: ${formatPeso(entry.revenue)}`}>
                                    <span className="sc-chart-value">{formatCompactPeso(entry.revenue)}</span>
                                    <div className="sc-chart-bar-track">
                                      <div className={`sc-chart-bar-fill revenue ${entry.revenue ? '' : 'is-zero'}`} style={{ height: `${pct}%` }} />
                                    </div>
                                    <span className="sc-chart-bar-label">{entry.label}</span>
                                 </div>
                                )
                              })}
                            </div>
                         </div>
                       </div>
                     </article>
                    </div>
                  </section>

                  {/* Operations and shop setup */}
                  <div className="sc-dashboard-main-grid">
                    {/* Pending work and recent cases */}
                    <div className="sc-dashboard-main-column">
                      {/* Pending work */}
                      <section className="sc-dashboard-panel sc-action-center-panel">
                        <div className="sc-panel-header">
                          <div>
                            <div className="sc-panel-kicker">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                              Pending work
                            </div>
                            <h2 className="sc-panel-title">Pending work</h2>
                          </div>
                          {attentionCount > 0 ? (
                            <span className="sc-attention-pill active">
                              <span className="sc-badge-pulse-dot crimson" />
                              {attentionCount} pending
                            </span>
                          ) : (
                            <span className="sc-attention-pill clear">
                              None pending
                            </span>
                          )}
                        </div>

                        <div className="sc-action-list">
                          {stats.newRequests > 0 && (
                            <button
                              type="button"
                              className="sc-action-card priority"
                              onClick={() => setActiveTab('orders')}
                            >
                              <div className="sc-action-card-icon-wrap crimson">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                              </div>
                              <div className="sc-action-card-body">
                                <div className="sc-action-card-heading">
                                  <strong>Review new requests</strong>
                                  <span className="sc-action-urgency-badge crimson">New</span>
                                </div>
                                <p>{stats.newRequests} request{stats.newRequests === 1 ? '' : 's'} waiting for review.</p>
                              </div>
                              <div className="sc-action-card-tail">
                                <span className="sc-action-badge crimson">{stats.newRequests}</span>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                              </div>
                            </button>
                          )}

                          {stats.paymentsToVerify > 0 && (
                            <button
                              type="button"
                              className="sc-action-card warning"
                              onClick={() => setActiveTab('payments')}
                            >
                              <div className="sc-action-card-icon-wrap amber">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                              </div>
                              <div className="sc-action-card-body">
                                <div className="sc-action-card-heading">
                                  <strong>Verify payments</strong>
                                  <span className="sc-action-urgency-badge amber">Pending</span>
                                </div>
                                <p>{stats.paymentsToVerify} payment{stats.paymentsToVerify === 1 ? '' : 's'} waiting for verification.</p>
                              </div>
                              <div className="sc-action-card-tail">
                                <span className="sc-action-badge amber">{stats.paymentsToVerify}</span>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                              </div>
                            </button>
                          )}

                          {stats.toProcessShipment > 0 && (
                            <button
                              type="button"
                              className="sc-action-card info"
                              onClick={() => setActiveTab('orders')}
                            >
                              <div className="sc-action-card-icon-wrap emerald">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                              </div>
                              <div className="sc-action-card-body">
                                <div className="sc-action-card-heading">
                                  <strong>Prepare confirmed cases</strong>
                                  <span className="sc-action-urgency-badge emerald">Ready</span>
                                </div>
                                <p>{stats.toProcessShipment} case{stats.toProcessShipment === 1 ? '' : 's'} ready to process.</p>
                              </div>
                              <div className="sc-action-card-tail">
                                <span className="sc-action-badge emerald">{stats.toProcessShipment}</span>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                              </div>
                            </button>
                          )}

                          {(stats.lowStockProducts + stats.soldOutProducts) > 0 && (
                            <button
                              type="button"
                              className="sc-action-card neutral"
                              onClick={() => setActiveTab('products')}
                            >
                              <div className="sc-action-card-icon-wrap violet">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                              </div>
                              <div className="sc-action-card-body">
                                <div className="sc-action-card-heading">
                                  <strong>Update inventory</strong>
                                  <span className="sc-action-urgency-badge violet">Stock</span>
                                </div>
                                <p>{stats.lowStockProducts + stats.soldOutProducts} product{stats.lowStockProducts + stats.soldOutProducts === 1 ? '' : 's'} need attention.</p>
                              </div>
                              <div className="sc-action-card-tail">
                                <span className="sc-action-badge violet">{stats.lowStockProducts + stats.soldOutProducts}</span>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                              </div>
                            </button>
                          )}

                          {attentionCount === 0 && (
                            <div className="sc-action-empty-state">
                              <div className="sc-action-empty-icon">
                                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>
                              </div>
                              <div className="sc-action-empty-text">
                                <strong>No pending work</strong>
                                <p>New requests, payments, and stock alerts will appear here.</p>
                              </div>
                            </div>
                          )}
                        </div>
                      </section>

                      {/* Recent Cases */}
                      <section className="sc-dashboard-panel">
                        <div className="sc-panel-header">
                          <div>
                            <div className="sc-panel-kicker">Recent cases</div>
                            <h2 className="sc-panel-title">Recent Arrangements</h2>
                          </div>
                          <button type="button" className="sc-text-link-btn" onClick={() => setActiveTab('orders')}>
                            View all ({requests.length})
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                          </button>
                        </div>

                        {recentRequests.length === 0 ? (
                          <div className="sc-panel-empty-state">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                            <p>Arrangement requests from families will appear here.</p>
                          </div>
                        ) : (
                          <div className="sc-stream-list">
                            {recentRequests.map((request) => {
                              const name = request.requesterName || request.familyCoordinatorName || 'Family Request'
                              const initial = (name.trim().charAt(0) || 'C').toUpperCase()
                              const cleanStatus = String(request.status || 'pending').toLowerCase()
                              return (
                                <button
                                  type="button"
                                  key={request.id}
                                  className="sc-stream-row"
                                  onClick={() => openRequestDetail(request)}
                                >
                                  <div className="sc-stream-avatar">{initial}</div>
                                  <div className="sc-stream-body">
                                    <strong className="sc-stream-title">{name}</strong>
                                    <span className="sc-stream-subtitle">
                                      {request.productName || 'Funeral Service'} · {formatTimestamp(request.createdAt)}
                                    </span>
                                  </div>
                                  <span className={`sc-status sc-status-${cleanStatus}`}>
                                    {cleanStatus.replace(/_/g, ' ')}
                                  </span>
                                  <span className="sc-stream-chevron">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </section>
                    </div>

                    {/* Shop setup and schedule */}
                    <div className="sc-dashboard-side-column">
                      {/* Shop setup */}
                      <section className="sc-dashboard-panel sc-readiness-panel">
                        <div className="sc-panel-header compact">
                          <div>
                            <div className="sc-panel-kicker">Setup</div>
                            <h2 className="sc-panel-title">Shop setup</h2>
                          </div>
                          <span className={`sc-readiness-pct ${readinessProgress === 100 ? 'complete' : ''}`}>
                            {readinessProgress}%
                          </span>
                        </div>

                        <div className="sc-readiness-bar" aria-label={`Setup ${readinessProgress}% complete`}>
                          <div
                            className="sc-readiness-bar-fill"
                            style={{ width: `${readinessProgress}%` }}
                          />
                        </div>

                        <div className="sc-readiness-list">
                          {readinessItems.map((item) => (
                            <button
                              type="button"
                              key={item.label}
                              className={`sc-readiness-row ${item.complete ? 'is-complete' : ''}`}
                              onClick={() => setActiveTab(item.tab)}
                            >
                              <div className="sc-readiness-status-icon">
                                {item.complete ? (
                                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                                ) : (
                                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>
                                )}
                              </div>
                              <div className="sc-readiness-info">
                                <strong>{item.label}</strong>
                                <small>{item.detail}</small>
                              </div>
                              <span className="sc-readiness-chevron">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                              </span>
                            </button>
                          ))}
                        </div>
                      </section>

                      {/* Scheduled services */}
                      <section className="sc-dashboard-panel">
                        <div className="sc-panel-header">
                          <div>
                            <div className="sc-panel-kicker">Schedule</div>
                            <h2 className="sc-panel-title">Upcoming Services</h2>
                          </div>
                          <button type="button" className="sc-text-link-btn" onClick={() => setActiveTab('calendar')}>
                            View calendar
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                          </button>
                        </div>

                        {upcomingRequests.length === 0 ? (
                          <div className="sc-panel-empty-state">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                            <p>No upcoming services.</p>
                          </div>
                        ) : (
                          <div className="sc-stream-list">
                            {upcomingRequests.map((request) => {
                              const dateObj = request.wakeStartDate ? new Date(request.wakeStartDate) : null
                              const dayNum = dateObj && !isNaN(dateObj.getTime()) ? dateObj.getDate() : '--'
                              const monthStr = dateObj && !isNaN(dateObj.getTime()) ? dateObj.toLocaleDateString('en-PH', { month: 'short' }).toUpperCase() : 'TBD'
                              return (
                                <button
                                  type="button"
                                  key={request.id}
                                  className="sc-stream-row"
                                  onClick={() => openRequestDetail(request)}
                                >
                                  <div className="sc-calendar-chip">
                                    <span className="sc-cal-month">{monthStr}</span>
                                    <strong className="sc-cal-day">{dayNum}</strong>
                                  </div>
                                  <div className="sc-stream-body">
                                    <strong className="sc-stream-title">{request.deceasedFullName || request.productName || 'Arrangement service'}</strong>
                                    <span className="sc-stream-subtitle">
                                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                                      {request.wakeAddress || request.churchName || 'Venue not set'}
                                    </span>
                                  </div>
                                  <span className="sc-stream-meta-date">{formatScheduleDate(request.wakeStartDate)}</span>
                                  <span className="sc-stream-chevron">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </section>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'messages' && (
                <section className="sc-messages-workspace" aria-label="Messages">
                  <Suspense fallback={<div className="sc-state"><p>Loading messages...</p></div>}>
                    <EmbeddedChat embedded onClose={() => setActiveTab('dashboard')} />
                  </Suspense>
                </section>
              )}

              {/* CUSTOMERS VIEW */}
              {activeTab === 'customers' && (
                <div className='sc-ops-page sc-customers-layout'>
                  <div className='sc-section-head'>
                    <div>
                      <h2>Customers</h2>
                      <p className='sc-card-subtitle'>Family contacts and their complete arrangement history.</p>
                    </div>
                    <span className='sc-count-label'>{customers.length} {customers.length === 1 ? 'customer' : 'customers'}</span>
                  </div>
                  <input
                    className='sc-simple-search'
                    value={customerSearch}
                    onChange={(event) => setCustomerSearch(event.target.value)}
                    placeholder='Search by name or contact number'
                    aria-label='Search customers'
                  />
                  {visibleCustomers.length === 0 ? (
                    <div className='sc-empty'>
                      <p>{customers.length ? 'No customers match your search.' : 'Customer profiles will appear after families send requests.'}</p>
                    </div>
                  ) : (
                    <div className='sc-customer-card-list'>
                      {visibleCustomers.map((customer) => (
                        <article
                          key={customer.id}
                          className='sc-customer-card'
                          onClick={() => setSelectedCustomerId(customer.id)}
                          role='button'
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              setSelectedCustomerId(customer.id)
                            }
                          }}
                        >
                          <div className='sc-customer-card-head'>
                            <span className='sc-customer-avatar'>
                              {customer.name.trim().charAt(0).toUpperCase() || 'C'}
                            </span>
                            <div className='sc-customer-card-identity'>
                              <div className='sc-customer-card-title-row'>
                                <strong>{customer.name}</strong>
                                {customer.activeCount > 0 && (
                                  <span className='sc-customer-active-badge'>{customer.activeCount} active</span>
                                )}
                              </div>
                              <span className='sc-customer-card-contact'>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                                </svg>
                                {customer.contactNumber || 'No contact number'}
                              </span>
                            </div>
                            <span className='sc-row-arrow' aria-hidden='true'>›</span>
                          </div>

                          <div className='sc-customer-card-grid'>
                            <div className='sc-customer-card-cell'>
                              <span className='sc-customer-card-label'>Cases</span>
                              <strong className='sc-customer-card-val'>
                                {customer.arrangements.length} {customer.arrangements.length === 1 ? 'case' : 'cases'}
                              </strong>
                            </div>
                            <div className='sc-customer-card-cell'>
                              <span className='sc-customer-card-label'>Active</span>
                              <strong className={`sc-customer-card-val${customer.activeCount > 0 ? ' is-active' : ''}`}>
                                {customer.activeCount}
                              </strong>
                            </div>
                            <div className='sc-customer-card-cell is-wide'>
                              <span className='sc-customer-card-label'>Confirmed Value</span>
                              <strong className='sc-customer-card-val is-value'>
                                {formatPeso(customer.totalValue)}
                              </strong>
                            </div>
                          </div>

                          {customer.lastActivity && (
                            <div className='sc-customer-card-meta'>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                              </svg>
                              <span>Last activity: {formatTimestamp(customer.lastActivity)}</span>
                            </div>
                          )}

                          <div className='sc-customer-card-actions'>
                            <button
                              type='button'
                              className='sc-btn sc-btn-sm sc-btn-secondary sc-customer-view-btn'
                              onClick={(e) => {
                                e.stopPropagation()
                                setSelectedCustomerId(customer.id)
                              }}
                            >
                              View Customer Details
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* CALENDAR VIEW */}
              {activeTab === 'calendar' && (
                <div className='sc-ops-page sc-service-schedule'>
                  <div className='sc-section-head sc-schedule-page-head'>
                    <div>
                      <h2>Service Schedule</h2>
                    </div>
                    <div className='sc-schedule-head-actions'>
                      <button className='sc-btn' onClick={() => void loadShopSchedule()} disabled={scheduleLoading}>Refresh</button>
                      <button className='sc-btn sc-btn-primary' onClick={() => openNewScheduleEvent()}>+ Add event</button>
                    </div>
                  </div>

                  <div className='sc-schedule-summary' aria-label='Schedule summary'>
                    <div><strong>{combinedScheduleItems.filter(item => item.dateKey === scheduleTodayKey).length}</strong><span>Today</span></div>
                    <div><strong>{scheduleNextWeek}</strong><span>Next 7 days</span></div>
                    <div><strong>{shopScheduleEvents.length}</strong><span>Shop events</span></div>
                  </div>

                  <div className='sc-schedule-filters' role='group' aria-label='Filter schedule'>
                    {([
                      ['all', 'All'],
                      ['requests', 'Requests'],
                      ['shop', 'Shop events'],
                    ] as [ScheduleFilter, string][]).map(([value, label]) => (
                      <button
                        key={value}
                        type='button'
                        className={scheduleFilter === value ? 'active' : ''}
                        onClick={() => setScheduleFilter(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {scheduleError && (
                    <div className='sc-schedule-error'>
                      <span>{scheduleError}</span>
                      <button type='button' onClick={() => void loadShopSchedule()}>Retry</button>
                    </div>
                  )}

                  <div className='sc-schedule-workspace'>
                    <section className='sc-schedule-calendar-card' aria-label='Monthly calendar'>
                      <div className='sc-schedule-calendar-head'>
                        <button
                          type='button'
                          aria-label='Previous month'
                          onClick={() => setScheduleMonth(current => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
                        >
                          ‹
                        </button>
                        <div>
                          <strong>{scheduleMonth.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}</strong>
                          <button
                            type='button'
                            className='sc-schedule-today-link'
                            onClick={() => {
                              const today = new Date()
                              setScheduleMonth(new Date(today.getFullYear(), today.getMonth(), 1))
                              setSelectedScheduleDate(toScheduleDateKey(today))
                            }}
                          >
                            Today
                          </button>
                        </div>
                        <button
                          type='button'
                          aria-label='Next month'
                          onClick={() => setScheduleMonth(current => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
                        >
                          ›
                        </button>
                      </div>

                      <div className='sc-schedule-weekdays'>
                        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <span key={day}>{day}</span>)}
                      </div>
                      <div className='sc-schedule-calendar-grid'>
                        {scheduleCalendarDays.map(date => {
                          const dateKey = toScheduleDateKey(date)
                          const dayItems = scheduleItemsByDate[dateKey] || []
                          const outsideMonth = date.getMonth() !== scheduleMonth.getMonth()
                          const selected = dateKey === selectedScheduleDate
                          const today = dateKey === scheduleTodayKey
                          return (
                            <button
                              key={dateKey}
                              type='button'
                              className={`${outsideMonth ? 'is-outside ' : ''}${selected ? 'is-selected ' : ''}${today ? 'is-today' : ''}`.trim()}
                              onClick={() => {
                                setSelectedScheduleDate(dateKey)
                                if (outsideMonth) setScheduleMonth(new Date(date.getFullYear(), date.getMonth(), 1))
                              }}
                              aria-label={`${formatScheduleDayHeading(dateKey)}${dayItems.length ? `, ${dayItems.length} scheduled` : ''}`}
                            >
                              <span className='sc-schedule-day-number'>{date.getDate()}</span>
                              <span className='sc-schedule-day-dots' aria-hidden='true'>
                                {dayItems.slice(0, 3).map(item => <i key={item.id} className={`is-${item.kind}`} />)}
                                {dayItems.length > 3 && <small>+{dayItems.length - 3}</small>}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                      <div className='sc-schedule-legend'>
                        <span><i className='is-wake' />Wake</span>
                        <span><i className='is-burial' />Burial</span>
                        <span><i className='is-appointment' />Shop event</span>
                      </div>
                    </section>

                    <section className='sc-schedule-agenda-card' aria-label='Selected day agenda'>
                      <div className='sc-schedule-agenda-head'>
                        <div>
                          <h3>{formatScheduleDayHeading(selectedScheduleDate)}</h3>
                          <p>{selectedScheduleItems.length === 1 ? '1 scheduled item' : `${selectedScheduleItems.length} scheduled items`}</p>
                        </div>
                        <button type='button' onClick={() => openNewScheduleEvent(selectedScheduleDate)} aria-label='Add event on selected day'>+</button>
                      </div>

                      {scheduleLoading ? (
                        <div className='sc-schedule-agenda-empty'><span className='sc-spinner' /><p>Loading schedule…</p></div>
                      ) : selectedScheduleItems.length ? (
                        <div className='sc-schedule-agenda-list'>
                          {selectedScheduleItems.map(item => (
                            <button
                              key={item.id}
                              type='button'
                              className={`sc-schedule-agenda-item is-${item.kind}`}
                              onClick={() => item.request ? openRequestDetail(item.request) : item.event ? openScheduleEvent(item.event) : undefined}
                            >
                              <span className='sc-schedule-agenda-copy'>
                                <small>{item.timeLabel}</small>
                                <strong>{item.title}</strong>
                                <span>{item.subtitle}{item.location ? ` · ${item.location}` : ''}</span>
                              </span>
                              <span className='sc-row-arrow' aria-hidden='true'>›</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className='sc-schedule-agenda-empty'>
                          <strong>No events</strong>
                          <button type='button' onClick={() => openNewScheduleEvent(selectedScheduleDate)}>Add event</button>
                        </div>
                      )}
                    </section>
                  </div>

                  <section className='sc-schedule-register'>
                    <div className='sc-schedule-register-head'>
                      <div>
                        <h3>Service records</h3>
                      </div>
                      <span>{scheduledRequests.length} records</span>
                    </div>
                    {scheduledRequests.length ? (
                      <div className='sc-schedule-register-list'>
                        {scheduledRequests.map(request => (
                          <button key={request.id} type='button' onClick={() => openRequestDetail(request)}>
                            <span className='sc-date-tile'>
                              <strong>{request.wakeStartDate ? new Date(`${String(request.wakeStartDate).slice(0, 10)}T00:00:00`).getDate() : '--'}</strong>
                              <small>{request.wakeStartDate ? new Date(`${String(request.wakeStartDate).slice(0, 10)}T00:00:00`).toLocaleDateString('en-PH', { month: 'short' }) : 'TBD'}</small>
                            </span>
                            <span className='sc-schedule-main'>
                              <strong>{request.deceasedFullName || request.productName || 'Arrangement case'}</strong>
                              <small>{request.familyCoordinatorName || request.requesterName || 'Family coordinator'} · {request.wakeAddress || 'Venue not set'}</small>
                            </span>
                            <span className='sc-schedule-record-dates'>
                              <small>Wake</small>
                              <strong>{formatScheduleDate(request.wakeStartDate)} – {formatScheduleDate(request.wakeEndDate)}</strong>
                            </span>
                            <span className={`sc-status sc-status-${String(request.status || '').toLowerCase()}`}>{String(request.status || 'pending').replace(/_/g, ' ')}</span>
                            <span className='sc-row-arrow' aria-hidden='true'>›</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className='sc-empty'><p>No scheduled service requests.</p></div>
                    )}
                  </section>
                </div>
              )}

              {/* REPORTS VIEW */}
              {activeTab === 'reports' && (
                <div className='sc-ops-page'>
                  <div className='sc-section-head'>
                    <div>
                      <h2>Reports</h2>
                      <p className='sc-card-subtitle'>A simple view of sales, cases, and inventory health.</p>
                    </div>
                    <button className='sc-btn' onClick={() => void loadData()} disabled={loading}>Refresh</button>
                  </div>
                  <div className='sc-report-grid'>
                    <article><span>Confirmed revenue</span><strong>{formatPeso(report.revenue)}</strong></article>
                    <article><span>Accepted cases</span><strong>{report.accepted}</strong></article>
                    <article><span>Completed cases</span><strong>{report.completed}</strong></article>
                    <article><span>Acceptance rate</span><strong>{report.conversionRate}%</strong></article>
                    <article><span>Average case value</span><strong>{formatPeso(report.averageValue)}</strong></article>
                    <article><span>Stock attention</span><strong>{report.lowStock + report.soldOut}</strong></article>
                  </div>
                  <div className='sc-report-panel'>
                    <div className='sc-card-header'>
                      <h3>Cases received - last 6 months</h3>
                      <span className='sc-card-subtitle'>Based on arrangement creation date</span>
                    </div>
                    <div className='sc-simple-chart'>
                      {report.monthly.map((entry) => (
                        <div className='sc-chart-column' key={entry.key}>
                          <strong>{entry.cases}</strong>
                          <div className='sc-chart-track'><span style={{ height: `${Math.max(4, Math.round((entry.cases / maxMonthlyCases) * 100))}%` }} /></div>
                          <small>{entry.label}</small>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className='sc-report-note'>
                    <strong>Inventory check</strong>
                    <span>{report.lowStock} low-stock product{report.lowStock === 1 ? '' : 's'} and {report.soldOut} unavailable product{report.soldOut === 1 ? '' : 's'}.</span>
                    <button type='button' className='sc-btn sc-btn-sm' onClick={() => setActiveTab('products')}>Review products</button>
                  </div>
                </div>
              )}

              {/* PRODUCTS VIEW */}
              {activeTab === 'products' && (
                <div className="sc-products-layout">
                  <div className="sc-section-head">
                    <h2>Products</h2>
                    <button className="sc-primary-btn" onClick={() => void openProductEditor(null)}>Add New Product</button>
                  </div>

                  <div className="sc-tabs">
                    <button className={`sc-tab${productTab === 'all' ? ' active' : ''}`} onClick={() => setProductTab('all')}>All</button>
                    <button className={`sc-tab${productTab === 'live' ? ' active' : ''}`} onClick={() => setProductTab('live')}>Live</button>
                    <button className={`sc-tab${productTab === 'soldout' ? ' active' : ''}`} onClick={() => setProductTab('soldout')}>Sold Out</button>
                  </div>

                  {filtered.length === 0 ? (
                    <div className="sc-empty">
                      <p>{productTab === 'all' ? 'No products yet.' : `No ${productTab} products.`}</p>
                    </div>
                  ) : (
                    <div className="sc-table-wrap">
                      <table className="sc-table">
                        <thead>
                          <tr>
                            <th>Product</th>
                            <th>Price</th>
                            <th>Stock</th>
                            <th>Variants</th>
                            <th>Status</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map(item => {
                            const state = getProductState(item)
                            return (
                              <tr key={item.id}>
                                <td>
                                  <div className="sc-product-cell">
                                    {item.imageUrl ? (
                                      <img src={item.imageUrl} alt={item.name} className="sc-product-thumb" />
                                    ) : (
                                      <div className="sc-product-thumb-sc">LC</div>
                                    )}
                                    <span>{item.name}</span>
                                  </div>
                                </td>
                                <td>{formatPeso(item.price)}</td>
                                <td>{item.stock}</td>
                                <td>{item.variationCount > 0 ? item.variationCount : '—'}</td>
                                <td>
                                  <span className={`sc-status ${state === 'live' ? 'sc-status-live' : 'sc-status-soldout'}`}>
                                    {state === 'live' ? 'Live' : 'Sold Out'}
                                  </span>
                                </td>
                                <td>
                                  <div className="sc-actions">
                                    <button
                                      type="button"
                                      className="sc-btn sc-btn-sm sc-btn-secondary"
                                      disabled={saving}
                                      onClick={() => void openProductDetail(item)}
                                    >
                                      View
                                    </button>
                                    <button
                                      type="button"
                                      className="sc-btn sc-btn-sm sc-btn-secondary"
                                      disabled={saving}
                                      onClick={() => void openProductEditor(item.id)}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      className="sc-btn sc-btn-sm"
                                      disabled={saving}
                                      onClick={() => void handleToggleProduct(item)}
                                    >
                                      {item.active ? 'Pause' : 'Activate'}
                                    </button>
                                    <button
                                      type="button"
                                      className="sc-btn sc-btn-sm sc-btn-danger"
                                      disabled={saving}
                                      onClick={() => void handleDeleteProduct(item)}
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* PACKAGES VIEW */}
              {activeTab === 'packages' && (
                <div className="sc-packages-layout">
                  <div className="sc-section-head">
                    <div>
                      <h2>Packages</h2>
                      <p className="sc-card-subtitle">Create inclusions with a name and photo. They come with every casket at no separate price.</p>
                    </div>
                    <button className="sc-primary-btn" disabled={packageSaving || Boolean(uploadingPackageItemId)} onClick={() => void handleSavePackage()}>
                      {packageSaving ? 'Saving...' : 'Save Package'}
                    </button>
                  </div>

                  {packageItems.length === 0 && (
                    <div className="sc-package-empty">
                      <strong>No inclusions yet</strong>
                      <span>Add anything your shop provides. You choose the name and photo.</span>
                    </div>
                  )}

                  <div className="sc-package-grid">
                    {packageItems.map((item, index) => {
                      const imageUrl = item.imageUrl || null
                      const uploading = uploadingPackageItemId === item.id
                      return (
                        <section className="sc-package-tile" key={item.id}>
                          <div className="sc-package-tile-head">
                            <h3>Inclusion {index + 1}</h3>
                            <button
                              type="button"
                              className="sc-package-remove"
                              disabled={packageSaving || Boolean(uploadingPackageItemId)}
                              onClick={() => removePackageItem(item.id)}
                            >
                              Remove
                            </button>
                          </div>
                          <label className="sc-package-name-label" htmlFor={`package-name-${item.id}`}>What is included?</label>
                          <input
                            id={`package-name-${item.id}`}
                            className="sc-form-input sc-package-name-input"
                            type="text"
                            maxLength={80}
                            value={item.name}
                            placeholder="e.g. Memorial flower arrangement"
                            disabled={packageSaving}
                            onChange={event => updatePackageItem(item.id, { name: event.target.value })}
                          />
                          <div className="sc-package-image-box">
                            {imageUrl ? <img src={imageUrl} alt={item.name || `Inclusion ${index + 1}`} /> : uploading ? <div className="sc-spinner" /> : <span>No picture added</span>}
                          </div>
                          <label className="sc-btn sc-btn-secondary sc-package-upload">
                            {imageUrl ? 'Replace Picture' : 'Upload Picture'}
                            <input
                              type="file"
                              accept="image/*"
                              style={{ display: 'none' }}
                              disabled={uploadingPackageItemId !== null || packageSaving}
                              onChange={(event) => void handlePackageImageUpload(item.id, event)}
                            />
                          </label>
                        </section>
                      )
                    })}
                  </div>

                  <button
                    type="button"
                    className="sc-package-add"
                    disabled={packageSaving || Boolean(uploadingPackageItemId) || packageItems.length >= MAX_PACKAGE_ITEMS}
                    onClick={addPackageItem}
                  >
                    {packageItems.length >= MAX_PACKAGE_ITEMS ? 'Maximum 12 inclusions' : '+ Add Inclusion'}
                  </button>

                </div>
              )}

              {/* ORDERS VIEW */}
              {activeTab === 'orders' && (
                <div className="sc-orders-layout">
                  <div className='sc-section-head'>
                    <div>
                      <h2>Arrangement Cases</h2>
                      <p className='sc-card-subtitle'>Track each family from request through payment, preparation, and completion.</p>
                    </div>
                    <span className='sc-count-label'>{visibleArrangementRequests.length} cases</span>
                  </div>
                  <div className="sc-tabs" role="tablist" aria-label="Arrangement case filters">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={arrangementFilter === 'all'}
                      className={`sc-tab${arrangementFilter === 'all' ? ' active' : ''}`}
                      onClick={() => setArrangementFilter('all')}
                    >All Cases ({requests.length})</button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={arrangementFilter === 'custom_casket'}
                      className={`sc-tab${arrangementFilter === 'custom_casket' ? ' active' : ''}`}
                      onClick={() => setArrangementFilter('custom_casket')}
                    >Custom Casket Requests ({customCasketRequests.length})</button>
                  </div>
                  {visibleArrangementRequests.length === 0 ? (
                    <div className="sc-empty"><p>{arrangementFilter === 'custom_casket' ? 'No custom casket requests yet.' : 'No service requests yet.'}</p></div>
                  ) : (
                    <div className="sc-table-wrap">
                      <table className="sc-table">
                        <thead>
                          <tr>
                            <th>Product</th>
                            <th>Requestor Details</th>
                            <th>Deceased Info</th>
                            <th>Status</th>
                            <th>Payment</th>
                            <th>Date</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleArrangementRequests.map(r => (
                            <tr key={r.id}>
                              <td>
                                <div className="sc-product-cell">
                                  {getRequestImageUrl(r) ? (
                                    <img src={getRequestImageUrl(r) as string} alt={isCustomCasketRequest(r) ? 'Custom casket reference' : r.productName} className="sc-product-thumb" />
                                  ) : (
                                    <div className="sc-product-thumb-sc">LC</div>
                                  )}
                                  <div>
                                    <div style={{ fontWeight: 600 }}>{r.productName || 'Custom Casket'}</div>
                                    {r.variationName && <div style={{ fontSize: '11px', color: 'var(--sc-muted)' }}>Variation: {r.variationName}</div>}
                                    {isCustomCasketRequest(r) && r.status === 'pending_shop_acceptance' ? (
                                      <div className="sc-custom-price-editor sc-custom-price-editor-table">
                                        <label htmlFor={`custom-price-table-${r.id}`}>Price upon acceptance</label>
                                        <div className="sc-custom-price-input-wrap">
                                          <span aria-hidden="true">₱</span>
                                          <input
                                            id={`custom-price-table-${r.id}`}
                                            type="number"
                                            min="1"
                                            max="999999999.99"
                                            step="0.01"
                                            inputMode="decimal"
                                            placeholder="Enter price"
                                            value={customPriceDrafts[r.id] ?? ''}
                                            onChange={event => setCustomPriceDrafts(current => ({ ...current, [r.id]: event.target.value }))}
                                          />
                                        </div>
                                        <small>Saved only when accepted</small>
                                      </div>
                                    ) : (
                                      <div style={{ fontSize: '12px', color: 'var(--sc-brand)', marginTop: '4px' }}>{formatPeso(r.productPrice)}</div>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td>
                                <div style={{ fontSize: '13px' }}>
                                  <div><strong>Type:</strong> {r.requestType?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</div>
                                  <div><strong>Contact:</strong> {r.contactNumber || '—'}</div>
                                </div>
                              </td>
                              <td>
                                <div style={{ fontSize: '13px' }}>
                                  <div>{r.deceasedFullName || '—'}</div>
                                  {r.deceasedDateOfPassing && (
                                    <div style={{ fontSize: '12px', color: 'var(--sc-muted)', marginTop: '2px' }}>
                                      Passing: {new Date(r.deceasedDateOfPassing).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}
                                    </div>
                                  )}
                                  {r.deceasedAge != null && (
                                    <div style={{ fontSize: '12px', color: 'var(--sc-muted)', marginTop: '2px' }}>
                                      Age at passing: {r.deceasedAge}
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td>
                                <span className={`sc-status sc-status-${(r.status || 'pending').toLowerCase()}`}>
                                  {(r.status || 'pending').replace(/_/g, ' ')}
                                </span>
                              </td>
                              <td>
                                {['awaiting_payment', 'payment_submitted', 'payment_verified', 'completed'].includes(String(r.status || '').toLowerCase()) ? (
                                  <div className="sc-payment-cell">
                                    <span className={`sc-status sc-status-${r.status.toLowerCase()}`}>
                                      {(r.status || '').replace(/_/g, ' ')}
                                    </span>
                                    {r.paymentAmount != null && Number(r.paymentAmount) > 0 && (
                                      <span style={{ fontSize: '12px', color: 'var(--sc-muted)' }}>{formatPeso(r.paymentAmount)}</span>
                                    )}
                                    {String(r.status || '').toLowerCase() === 'payment_submitted' && (
                                      <div className="sc-actions" style={{ marginTop: '6px' }}>
                                        <button
                                          className="sc-btn sc-btn-sm"
                                          style={{ borderColor: 'var(--sc-success)', color: 'var(--sc-success)' }}
                                          disabled={saving || paymentVerifyingId === r.id}
                                          onClick={() => void handleVerifyPayment(r, 'verified')}
                                        >
                                          Verify
                                        </button>
                                        <button
                                          className="sc-btn sc-btn-sm sc-btn-danger"
                                          disabled={saving || paymentVerifyingId === r.id}
                                          onClick={() => void handleVerifyPayment(r, 'rejected')}
                                        >
                                          Reject
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <span style={{ fontSize: '12px', color: 'var(--sc-muted)' }}>—</span>
                                )}
                              </td>
                              <td>{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '—'}</td>
                              <td>
                                <div className="sc-actions" style={{ flexDirection: 'column' }}>
                                  <button
                                    type="button"
                                    className="sc-btn sc-btn-sm sc-btn-secondary"
                                    disabled={saving}
                                    onClick={() => openRequestDetail(r)}
                                  >
                                    View
                                  </button>
                                  {r.status === 'pending_shop_acceptance' ? (
                                    <div className="sc-actions" style={{ flexDirection: 'column' }}>
                                      <button
                                        className="sc-btn sc-btn-sm"
                                        style={{ borderColor: 'var(--sc-success)', color: 'var(--sc-success)' }}
                                        onClick={() => void handleUpdateStatus(r, 'accepted_by_shop')}
                                        disabled={saving}
                                      >
                                        Accept
                                      </button>
                                      <button 
                                        className="sc-btn sc-btn-sm sc-btn-danger"
                                        onClick={() => void handleUpdateStatus(r, 'declined_by_shop')}
                                        disabled={saving}
                                      >
                                        Decline
                                      </button>
                                    </div>
                                  ) : r.status === 'accepted_by_shop' ? (
                                    <span style={{ fontSize: '12px', color: 'var(--sc-muted)' }}>Preparing secure checkout</span>
                                  ) : r.status === 'payment_verified' ? (
                                    <div className="sc-actions" style={{ flexDirection: 'column' }}>
                                      <button
                                        className="sc-btn sc-btn-sm"
                                        style={{ borderColor: 'var(--sc-success)', color: 'var(--sc-success)' }}
                                        onClick={() => openRequestDetail(r)}
                                        disabled={saving}
                                      >
                                        Mark Completed
                                      </button>
                                    </div>
                                  ) : (
                                    <span style={{ fontSize: '12px', color: 'var(--sc-muted)' }}>—</span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* PAYMENTS VIEW */}
              {activeTab === 'payments' && (
                <div className="sc-family-payments-layout">
                  <header className="sc-family-payments-header">
                    <div><h2>Family Payments</h2><p>Review customer payments for arrangement cases.</p></div>
                    <button type="button" className="sc-family-payments-refresh" onClick={() => void loadData()} disabled={loading}>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/></svg>
                      Refresh
                    </button>
                  </header>

                  <section className="sc-family-payments-summary" aria-label="Family payment summary">
                    <div className="sc-family-payments-summary-icon"><FamilyPaymentIcon name="wallet" /></div>
                    <h3>Family payment records</h3>
                    <p>Review uploaded receipts and provider-confirmed online payments.</p>
                    <div className="sc-family-payments-stats">
                      {[
                        { value: financeSummary.awaitingReview, label: 'Need review' },
                        { value: financeSummary.verified, label: 'Verified' },
                        { value: paymentSubmissions.length, label: 'Total' },
                      ].map(stat => (
                        <div key={stat.label} className="sc-family-payments-stat"><strong>{stat.value}</strong><span>{stat.label}</span></div>
                      ))}
                    </div>
                  </section>

                  <nav className="sc-family-payments-filters" aria-label="Filter family payments">
                    {([
                      { key: 'all', label: `All (${paymentSubmissions.length})` },
                      { key: 'review', label: `Needs review (${financeSummary.awaitingReview})` },
                      { key: 'verified', label: `Verified (${financeSummary.verified})` },
                    ] as { key: FamilyPaymentFilter; label: string }[]).map(item => (
                      <button type="button" key={item.key} className={familyPaymentFilter === item.key ? 'active' : ''} aria-pressed={familyPaymentFilter === item.key} onClick={() => setFamilyPaymentFilter(item.key)}>
                        {item.label}
                      </button>
                    ))}
                  </nav>

                  {visibleFamilyPayments.length === 0 ? (
                    <section className="sc-family-payments-empty">
                      <div><FamilyPaymentIcon name="receipt" /></div>
                      <h3>{familyPaymentFilter === 'all' ? 'No family payments yet' : 'Nothing in this filter'}</h3>
                      <p>Customer payment records will appear here.</p>
                    </section>
                  ) : (
                    <div className="sc-family-payments-list">
                      {visibleFamilyPayments.map(request => {
                        const statusMeta = getFamilyPaymentStatus(request)
                        const paymentReceipt = getFamilyPaymentReceipt(request)
                        const needsReview = String(request.status || '').toLowerCase() === 'payment_submitted'
                        const sender = request.paymentPayerName || request.familyCoordinatorName || request.requesterName || 'Unknown sender'
                        return (
                          <article key={request.id} className={`sc-family-payment-card${needsReview ? ' needs-review' : ''}`}>
                            <div className="sc-family-payment-top">
                              <div><h3 title={request.productName || 'Funeral service'}>{request.productName || 'Funeral service'}</h3><p>For {request.deceasedFullName || 'family service'}</p></div>
                              <span className={`sc-family-payment-status ${statusMeta.className}`}><FamilyPaymentIcon name={statusMeta.icon} />{statusMeta.label}</span>
                            </div>
                            <strong className="sc-family-payment-amount">{Number(request.paymentAmount) > 0 ? formatPeso(request.paymentAmount) : 'Amount not provided'}</strong>
                            <div className="sc-family-payment-meta">
                              <span><FamilyPaymentIcon name="person" />{sender}</span>
                              <span><FamilyPaymentIcon name="clock" />{formatTimestamp(request.paymentSubmittedAt || request.createdAt)}</span>
                              {request.paymentReferenceNumber ? <span><FamilyPaymentIcon name="key" />Reference {request.paymentReferenceNumber}</span> : null}
                            </div>
                            <footer className="sc-family-payment-footer">
                              <span className={paymentReceipt.available ? 'has-proof' : 'missing-proof'}><FamilyPaymentIcon name={paymentReceipt.icon} />{paymentReceipt.label}</span>
                              <button type="button" onClick={() => openRequestDetail(request)}>View Receipt<FamilyPaymentIcon name="chevron" /></button>
                            </footer>
                          </article>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* INDIVIDUAL PAYOUT METHOD SETUP */}
              {activeTab === 'payout_account_setup' && (
                <div className="sc-method-setup-page">
                  <button type="button" className="sc-method-setup-back" onClick={() => setActiveTab('payout_accounts')}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
                    Payment methods
                  </button>

                  {selectedPayoutChannel ? (
                    <section className="sc-method-setup-card">
                      <header className="sc-method-setup-header">
                        <div className={`sc-method-setup-logo is-${selectedPayoutChannel.type}`}>
                          <PayoutChannelLogo
                            channelCode={selectedPayoutChannel.value}
                            label={selectedPayoutChannel.label}
                            fallback={selectedPayoutChannel.label.slice(0, 2).toUpperCase()}
                          />
                        </div>
                        <div>
                          <span>{selectedPayoutChannel.type === 'wallet' ? 'E-wallet receiver' : 'Bank receiver'}</span>
                          <h2>{payoutAccounts.some(account => account.channelCode === payoutDraft.channel) ? 'Edit' : 'Add'} {selectedPayoutChannel.label}</h2>
                          <p>This page only manages your {selectedPayoutChannel.label} payout destination.</p>
                        </div>
                      </header>

                      <form className="sc-method-setup-form" onSubmit={event => { event.preventDefault(); void savePayoutAccount() }}>
                        <div className="sc-method-setup-readonly">
                          <span>Payment method</span>
                          <strong>{selectedPayoutChannel.label}</strong>
                        </div>

                        <label>
                          <span>Registered account holder</span>
                          <input
                            type="text"
                            value={payoutDraft.name}
                            maxLength={120}
                            autoComplete="name"
                            placeholder={selectedPayoutChannel.type === 'wallet' ? 'Name registered to the wallet' : 'Name registered to the bank account'}
                            onChange={event => setPayoutDraft(current => ({ ...current, name: event.target.value }))}
                          />
                        </label>

                        <label>
                          <span>{selectedPayoutChannel.type === 'wallet' ? 'Registered mobile number' : 'Bank account number'}</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={payoutDraft.number}
                            maxLength={30}
                            autoComplete="off"
                            placeholder={selectedPayoutChannel.type === 'wallet' ? '09XXXXXXXXX' : 'Enter account number'}
                            onChange={event => setPayoutDraft(current => ({ ...current, number: event.target.value }))}
                          />
                          <small>Enter the exact details registered with {selectedPayoutChannel.label}.</small>
                        </label>

                        <div className="sc-method-setup-notice">
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg>
                          <div>
                            <strong>Verification required</strong>
                            <span>Customers cannot use this method until an administrator verifies the receiver details.</span>
                          </div>
                        </div>

                        <footer>
                          <button type="button" className="sc-settings-secondary-btn" onClick={() => setActiveTab('payout_accounts')}>Cancel</button>
                          <button type="submit" className="sc-settings-primary-btn" disabled={savingPayout}>
                            {savingPayout ? 'Saving…' : 'Submit for verification'}
                          </button>
                        </footer>
                      </form>
                    </section>
                  ) : (
                    <div className="sc-payout-empty">
                      <strong>Select a payment method first</strong>
                      <span>Return to the payment methods list and choose the receiver you want to set up.</span>
                      <button type="button" onClick={() => setActiveTab('payout_accounts')}>View payment methods</button>
                    </div>
                  )}
                </div>
              )}

              {/* PAYOUT ACCOUNTS VIEW */}
              {activeTab === 'payout_accounts' && (
                <div className="sc-payout-page">
                  <header className="sc-payout-page-header">
                    <div>
                      <span>Finance</span>
                      <h2>Payout accounts</h2>
                      <p>Choose where each customer payment method sends your shop’s 70% share.</p>
                    </div>
                  </header>

                  <div className="sc-payout-overview-grid">
                    <article>
                      <span>Accounts set up</span>
                      <strong>{payoutAccounts.length}</strong>
                      <small>Wallets and bank accounts</small>
                    </article>
                    <article>
                      <span>Available to customers</span>
                      <strong>{payoutAccounts.filter(account => account.active && account.verifiedByAdmin).length}</strong>
                      <small>Active and verified methods</small>
                    </article>
                    <article>
                      <span>Waiting for review</span>
                      <strong>{payoutAccounts.filter(account => !account.verifiedByAdmin).length}</strong>
                      <small>Unavailable until approved</small>
                    </article>
                  </div>

                  <div className="sc-payout-page-note">
                    <FamilyPaymentIcon name="wallet" />
                    <div>
                      <strong>Customer methods follow your setup</strong>
                      <span>If GCash is not active and verified here, customers will not see GCash at checkout. The same rule applies to Maya and bank transfer.</span>
                    </div>
                  </div>

                  {!shopAccountApproved && (
                    <div className="sc-settings-notice">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>
                      <div><strong>Available after shop approval</strong><span>Your funeral shop must be approved before you can submit receiver accounts.</span></div>
                    </div>
                  )}

                  <section className="sc-payout-accounts-panel">
                    <header>
                      <div>
                        <span>Receiver accounts</span>
                        <h3>Configured payment methods</h3>
                      </div>
                    </header>

                    {payoutAccounts.length === 0 ? (
                      <div className="sc-payout-empty">
                        <div><FamilyPaymentIcon name="wallet" /></div>
                        <strong>No receiver accounts yet</strong>
                        <span>Add GCash, Maya, or a Philippine bank account. Customers will only see methods that are active and verified.</span>
                        {shopAccountApproved && <button type="button" onClick={() => openPayoutAccountEditor(undefined, SHOP_PAYOUT_CHANNELS[0].value)}>Add your first account</button>}
                      </div>
                    ) : (
                      <div className="sc-payout-account-list">
                        {payoutAccounts.map(account => {
                          const channel = SHOP_PAYOUT_CHANNELS.find(item => item.value === account.channelCode)
                          const enabled = account.active && account.verifiedByAdmin
                          return (
                            <article className={`sc-payout-account-card${!account.active ? ' is-disabled' : ''}`} key={account.id}>
                              <div className={`sc-payout-account-logo is-${channel?.type || 'bank'}`}>
                                <PayoutChannelLogo
                                  channelCode={account.channelCode}
                                  label={channel?.label || account.channelCode}
                                  fallback={channel?.type === 'wallet' ? 'W' : 'B'}
                                />
                              </div>
                              <div className="sc-payout-account-copy">
                                <div>
                                  <span>{channel?.type === 'wallet' ? 'E-wallet' : 'Philippine bank'}</span>
                                  <strong>{getPayoutChannelLabel(account.channelCode)}</strong>
                                </div>
                                <p>{account.accountName}</p>
                                <small>{maskPayoutAccount(account.accountNumber)}</small>
                              </div>
                              <div className="sc-payout-account-status">
                                <span className={enabled ? 'is-enabled' : account.verifiedByAdmin ? 'is-disabled' : 'is-pending'}>
                                  <i aria-hidden="true" />
                                  {enabled ? 'Available to customers' : account.verifiedByAdmin ? 'Disabled' : 'Awaiting verification'}
                                </span>
                                {account.verifiedAt && <small>Verified {new Date(account.verifiedAt).toLocaleDateString('en-PH')}</small>}
                              </div>
                              <div className="sc-payout-account-actions">
                                <button type="button" onClick={() => openPayoutAccountEditor(account)}>Edit</button>
                                <button type="button" disabled={savingPayout} onClick={() => void togglePayoutAccount(account)}>
                                  {account.active ? 'Disable' : 'Enable'}
                                </button>
                              </div>
                            </article>
                          )
                        })}
                      </div>
                    )}
                  </section>

                  <section className="sc-payout-methods-panel">
                    <header>
                      <div>
                        <span>Payment methods</span>
                        <h3>Add or manage a receiver</h3>
                        <p>Each option opens its own secure setup page.</p>
                      </div>
                    </header>

                    <div className="sc-payout-method-group">
                      <span className="sc-payout-method-group-title">E-wallets</span>
                      {SHOP_PAYOUT_CHANNELS.filter(channel => channel.type === 'wallet').map(channel => {
                        const account = payoutAccounts.find(item => item.channelCode === channel.value)
                        return (
                          <button
                            type="button"
                            className="sc-payout-method-row"
                            key={channel.value}
                            disabled={!shopAccountApproved}
                            onClick={() => openPayoutAccountEditor(account, channel.value)}
                          >
                            <span className="sc-payout-method-brand is-wallet">
                              <PayoutChannelLogo
                                channelCode={channel.value}
                                label={channel.label}
                                fallback={channel.label.slice(0, 2).toUpperCase()}
                              />
                            </span>
                            <span className="sc-payout-method-copy">
                              <strong>{account ? channel.label : `Add ${channel.label}`}</strong>
                              <small>{account ? `${account.accountName} · ${maskPayoutAccount(account.accountNumber)}` : 'Set up a new e-wallet receiver'}</small>
                            </span>
                            <span className={`sc-payout-method-state${account?.active && account.verifiedByAdmin ? ' is-ready' : account ? ' is-pending' : ''}`}>
                              {account?.active && account.verifiedByAdmin ? 'Ready' : account ? 'Manage' : 'Add'}
                            </span>
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
                          </button>
                        )
                      })}
                    </div>

                    <div className="sc-payout-method-group">
                      <span className="sc-payout-method-group-title">Philippine banks</span>
                      {SHOP_PAYOUT_CHANNELS.filter(channel => channel.type === 'bank').map(channel => {
                        const account = payoutAccounts.find(item => item.channelCode === channel.value)
                        return (
                          <button
                            type="button"
                            className="sc-payout-method-row"
                            key={channel.value}
                            disabled={!shopAccountApproved}
                            onClick={() => openPayoutAccountEditor(account, channel.value)}
                          >
                            <span className="sc-payout-method-brand">
                              <PayoutChannelLogo
                                channelCode={channel.value}
                                label={channel.label}
                                fallback={channel.label.split(' ').map(part => part[0]).join('').slice(0, 3)}
                              />
                            </span>
                            <span className="sc-payout-method-copy">
                              <strong>{account ? channel.label : `Add ${channel.label}`}</strong>
                              <small>{account ? `${account.accountName} · ${maskPayoutAccount(account.accountNumber)}` : 'Set up a bank receiver account'}</small>
                            </span>
                            <span className={`sc-payout-method-state${account?.active && account.verifiedByAdmin ? ' is-ready' : account ? ' is-pending' : ''}`}>
                              {account?.active && account.verifiedByAdmin ? 'Ready' : account ? 'Manage' : 'Add'}
                            </span>
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
                          </button>
                        )
                      })}
                    </div>
                  </section>
                </div>
              )}

              {/* REGISTERED INFORMATION VIEW */}
              {activeTab === 'registered_information' && (
                <div className="sc-registered-layout">
                  <button
                    type="button"
                    className="sc-registered-back"
                    onClick={() => navigate('/seller?tab=settings')}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
                    Back to Funeral Shop Settings
                  </button>

                  <header className="sc-registered-header">
                    <div>
                      <span>Shop account</span>
                      <h2>Registered information</h2>
                      <p>Review the legal business and tax details submitted for LifeCycle verification.</p>
                    </div>
                    <span className={'sc-registered-status' + (shopAccountApproved ? ' is-verified' : '')}>
                      <i aria-hidden="true" />
                      {shopAccountApproved ? 'Verified' : 'Under review'}
                    </span>
                  </header>

                  <section className="sc-registered-card">
                    <div className="sc-registered-notice">
                      <span className="sc-registered-notice-icon">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
                      </span>
                      <div>
                        <strong>Verified details are read-only</strong>
                        <p>Request a correction if your registered business information has changed.</p>
                      </div>
                    </div>

                    <div className="sc-registered-section">
                      <header>
                        <h3>Registered business</h3>
                        <p>Business identity and registered operating address.</p>
                      </header>
                      <dl className="sc-registered-grid">
                        <div>
                          <dt>Business name</dt>
                          <dd>{shop.businessName || shop.shopName || 'Not provided'}</dd>
                        </div>
                        <div>
                          <dt>Registered owner</dt>
                          <dd>{shop.individualRegisteredName || 'Not provided'}</dd>
                        </div>
                        <div>
                          <dt>General location</dt>
                          <dd>{shop.generalLocation || 'Not provided'}</dd>
                        </div>
                        <div>
                          <dt>ZIP code</dt>
                          <dd>{shop.zipCode || 'Not provided'}</dd>
                        </div>
                        <div className="is-wide">
                          <dt>Registered address</dt>
                          <dd>{shop.registeredAddress || 'Not provided'}</dd>
                        </div>
                      </dl>
                    </div>

                    <div className="sc-registered-section">
                      <header>
                        <h3>Tax details</h3>
                        <p>Information used during registration review.</p>
                      </header>
                      <dl className="sc-registered-grid">
                        <div>
                          <dt>Taxpayer Identification Number (TIN)</dt>
                          <dd>{shop.tin || 'Not provided'}</dd>
                        </div>
                        <div>
                          <dt>VAT registration status</dt>
                          <dd>{shop.vatRegistrationStatus == null ? 'Not provided' : shop.vatRegistrationStatus ? 'VAT registered' : 'Non-VAT registered'}</dd>
                        </div>
                      </dl>
                    </div>

                    <footer className="sc-registered-footer">
                      <div>
                        <strong>Need to update something?</strong>
                        <span>LifeCycle Support will review legal information changes.</span>
                      </div>
                      <button type="button" onClick={() => navigate('/user/contact')}>Request a correction</button>
                    </footer>
                  </section>
                </div>
              )}

              {/* FUNERAL SHOP SETTINGS VIEW */}
              {activeTab === 'settings' && (
                <div className="sc-settings-layout">
                  <header className="sc-settings-header">
                    <div>
                      <h2>Funeral Shop Settings</h2>
                      <p>Manage your public shop profile, availability, and registered business details.</p>
                    </div>
                  </header>

                  <div className="sc-settings-columns is-single">
                    <div className="sc-settings-main-column">
                      <section className="sc-settings-panel">
                        <header className="sc-settings-panel-header">
                          <div>
                            <span>Storefront</span>
                            <h3>Public shop profile</h3>
                            <p>Keep the details families see accurate and up to date.</p>
                          </div>
                        </header>

                        <div className="sc-settings-profile-media">
                          <div className="sc-settings-cover-preview">
                            {shop.coverImageUrl ? <img src={shop.coverImageUrl} alt={`${shop.shopName} cover`} /> : <span>Cover photo</span>}
                            <label>
                              {uploadingShopCover ? 'Uploading…' : 'Change cover'}
                              <input type="file" accept="image/*" onChange={event => handleUploadShopImage(event, 'coverImageUrl')} />
                            </label>
                          </div>
                          <div className="sc-settings-logo-preview">
                            {shop.shopImageUrl ? <img src={shop.shopImageUrl} alt={shop.shopName} /> : <span>{shop.shopName.slice(0, 2).toUpperCase()}</span>}
                            <label>
                              {uploadingShopProfile ? 'Uploading…' : 'Change logo'}
                              <input type="file" accept="image/*" onChange={event => handleUploadShopImage(event, 'shopImageUrl')} />
                            </label>
                          </div>
                        </div>

                        {editingShopProfile ? (
                          <form className="sc-settings-profile-form" onSubmit={event => { event.preventDefault(); void saveShopProfile() }}>
                            <div className="sc-settings-profile-grid">
                              <label className="is-wide">
                                <span>Shop name</span>
                                <input type="text" maxLength={120} value={shopProfileDraft.name} onChange={event => setShopProfileDraft(current => ({ ...current, name: event.target.value }))} />
                              </label>
                              <label className="is-wide">
                                <span>Public address</span>
                                <textarea maxLength={220} rows={3} value={shopProfileDraft.address} onChange={event => setShopProfileDraft(current => ({ ...current, address: event.target.value }))} />
                              </label>
                              <label>
                                <span>Phone number</span>
                                <input type="tel" maxLength={24} value={shopProfileDraft.phone} onChange={event => setShopProfileDraft(current => ({ ...current, phone: event.target.value }))} />
                              </label>
                              <label>
                                <span>Service capacity</span>
                                <input type="number" min="1" max="20" step="1" value={shopProfileDraft.capacity} onChange={event => setShopProfileDraft(current => ({ ...current, capacity: event.target.value }))} />
                                <small>Maximum overlapping wake services.</small>
                              </label>
                            </div>
                            <footer className="sc-settings-profile-actions">
                              <button type="button" className="sc-settings-secondary-btn" onClick={cancelShopProfileEditor}>Cancel</button>
                              <button type="submit" className="sc-settings-primary-btn" disabled={savingShopProfile}>{savingShopProfile ? 'Saving…' : 'Save profile'}</button>
                            </footer>
                          </form>
                        ) : (
                          <div className="sc-settings-profile-summary">
                            <div><span>Shop name</span><strong>{shop.shopName}</strong></div>
                            <div><span>Phone</span><strong>{shop.shopPhoneNumber || 'Not provided'}</strong></div>
                            <div><span>Public address</span><strong>{shop.shopAddress || 'Not provided'}</strong></div>
                            <div><span>Account email</span><strong>{user?.email || 'Not provided'}</strong></div>
                            <div><span>General location</span><strong>{shop.generalLocation || 'Not provided'}</strong></div>
                            <div><span>Shop ID</span><strong className="sc-settings-shop-id" title={shop.id}>{shop.id}</strong></div>
                          </div>
                        )}

                        {!editingShopProfile && (
                          <footer className="sc-settings-profile-edit-footer">
                            <button type="button" className="sc-settings-header-action" onClick={openShopProfileEditor}>Edit profile</button>
                          </footer>
                        )}

                        <div className="sc-settings-row sc-settings-row-static">
                          <span className="sc-settings-row-icon">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
                          </span>
                          <span className="sc-settings-row-copy">
                            <strong>Storefront availability</strong>
                            <small>{shop.status === 'live' ? 'Families can currently find and order from your shop' : 'Your storefront is currently hidden from families'}</small>
                          </span>
                          <div className="sc-settings-availability-controls">
                            <button
                              type="button"
                              className={`sc-settings-availability${shop.status === 'live' ? ' is-live' : ''}`}
                              disabled
                              aria-label={shop.status === 'live' ? 'Storefront is online' : 'Storefront is offline'}
                            >
                              <i aria-hidden="true" />
                              {shop.status === 'live' ? 'Online' : 'Offline'}
                            </button>
                            <button
                              type="button"
                              className={`sc-settings-availability-action${shop.status === 'live' ? '' : ' is-enable'}`}
                              onClick={shop.status === 'live' ? handleGoOffline : handleGoLive}
                              disabled={!shopAccountApproved || saving}
                            >
                              {saving ? 'Saving...' : shop.status === 'live' ? 'Turn off' : 'Turn on'}
                            </button>
                          </div>
                        </div>
                      </section>

                      <section className="sc-settings-panel sc-settings-actions-panel">
                        <header className="sc-settings-panel-header">
                          <div>
                            <span>Shop account</span>
                            <h3>Registered business</h3>
                            <p>Review the legal information connected to this shop.</p>
                          </div>
                        </header>

                        <button
                          type="button"
                          className="sc-settings-row sc-settings-action-row"
                          onClick={() => navigate('/seller?tab=registered_information')}
                        >
                          <span className="sc-settings-row-icon">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V5l8-3 8 3v16"/><path d="M9 21v-4h6v4M8 7h.01M12 7h.01M16 7h.01M8 11h.01M12 11h.01M16 11h.01"/></svg>
                          </span>
                          <span className="sc-settings-row-copy">
                            <strong>Registered information</strong>
                            <small>Legal business, owner, address, TIN, and VAT details</small>
                          </span>
                          <span className="sc-settings-row-value">View details</span>
                          <svg className="sc-settings-row-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
                        </button>

                      </section>

                    </div>

                  </div>
                </div>
              )}

              {/* PAYMENTS TO ADMIN VIEW */}
              {activeTab === 'admin_payments' && (
                <div className="sc-payment-layout sc-admin-payments-layout">
                  <XenditShopPaymentCard
                    className="sc-lifecycle-payment-card"
                    onSuccess={() => void loadData()}
                  />
                </div>
              )}

              {/* PRODUCT EDITOR VIEW */}
              {activeTab === 'product_editor' && (
                <div className="sc-editor-layout">
                  <div className="sc-section-head">
                    <h2>{editingProductId ? 'Edit Product' : 'Add New Product'}</h2>
                    <button className="sc-btn sc-btn-secondary" onClick={() => setActiveTab('products')}>Back to Products</button>
                  </div>

                  {editorLoading ? (
                    <div className="sc-state">
                      <div className="sc-spinner" />
                      <p>Loading product details…</p>
                    </div>
                  ) : (
                    <div className="sc-card sc-editor-card">
                      {/* Photo Section */}
                      <div className="sc-editor-section">
                        <label className="sc-editor-section-title">
                          Product Images <span className="sc-required">*</span>
                          <span className="sc-editor-section-desc">Upload at least 1 product photo. Add more to show different angles.</span>
                        </label>
                        <div className="sc-image-slots-grid">
                          {editorImages.map((img, idx) => (
                            <div key={idx} className="sc-image-slot">
                              {img ? (
                                <div className="sc-image-preview-container">
                                  <img src={img} alt={`Product photo ${idx + 1}`} className="sc-image-preview" />
                                  <button type="button" className="sc-image-remove-btn" onClick={() => {
                                    setEditorImages(prev => {
                                      const next = prev.filter((_, i) => i !== idx)
                                      return next.length > 0 ? next : [null]
                                    })
                                  }}>
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                  </button>
                                </div>
                              ) : (
                                <label className="sc-image-upload-label">
                                  {editorUploadingIndex === idx ? (
                                    <div className="sc-spinner sc-spinner-sm" />
                                  ) : (
                                    <>
                                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                      <span>{idx === 0 ? 'Add photo' : `Photo ${idx + 1}`}</span>
                                    </>
                                  )}
                                  <input type="file" accept="image/jpeg,image/png" style={{ display: 'none' }} disabled={editorUploadingIndex !== null} onChange={(e) => void handleUploadImage(idx, e)} />
                                </label>
                              )}
                            </div>
                          ))}
                          <div className="sc-image-slot sc-image-add-slot">
                            <button type="button" className="sc-image-upload-label" disabled={editorUploadingIndex !== null} onClick={() => setEditorImages(prev => [...prev, null])}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                              <span>Add another photo</span>
                            </button>
                          </div>
                        </div>
                        <p className="sc-images-counter">{editorImages.filter(Boolean).length} photo{editorImages.filter(Boolean).length === 1 ? '' : 's'} uploaded (minimum 1)</p>
                      </div>

                      {/* Basic Fields */}
                      <div className="sc-editor-section">
                        <div className="sc-editor-form-grid">
                          <div className="sc-form-group">
                            <label htmlFor="prodName">Product Name <span className="sc-required">*</span></label>
                            <input id="prodName" type="text" className="sc-form-input" placeholder="e.g. Elegant White Wood Casket" value={editorName} onChange={(e) => setEditorName(e.target.value)} />
                          </div>
                          
                          <div className="sc-form-group">
                            <label htmlFor="prodPrice">Price (PHP) <span className="sc-required">*</span></label>
                            <input id="prodPrice" type="text" className="sc-form-input" placeholder="e.g. 25,000" value={editorPrice} onChange={(e) => setEditorPrice(e.target.value)} />
                          </div>

                          <div className="sc-form-group">
                            <label htmlFor="prodStock">Stock <span className="sc-required">*</span></label>
                            <input id="prodStock" type="number" min="0" className="sc-form-input" value={editorStock} onChange={(e) => setEditorStock(e.target.value)} />
                          </div>
                        </div>
                      </div>

                      {/* Variations Section */}
                      <div className="sc-editor-section">
                        <div className="sc-variation-toggle-row">
                          <label className="sc-checkbox-label">
                            <input type="checkbox" checked={editorHasVariations} onChange={(e) => {
                              setEditorHasVariations(e.target.checked)
                              if (e.target.checked && editorVariationEntries.length === 0) {
                                setEditorVariationEntries([{ name: "", price: "", imageUrl: null }])
                              }
                            }} />
                            <span className="sc-checkbox-text">This product has casket variations</span>
                          </label>
                        </div>

                        {editorHasVariations && (
                          <div className="sc-variation-detail-box">
                            <div className="sc-variation-grid">
                              {editorVariationEntries.map((entry, idx) => (
                                <div key={idx} className="sc-variation-card">
                                  <div className="sc-var-image-box">
                                    {entry.imageUrl ? (
                                      <div className="sc-image-preview-container">
                                        <img src={entry.imageUrl} alt={`Variation ${idx + 1}`} className="sc-var-preview-img" />
                                        <button type="button" className="sc-image-remove-btn" onClick={() => setEditorVariationEntries(prev => prev.map((item, i) => i === idx ? { ...item, imageUrl: null } : item))}>
                                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                        </button>
                                      </div>
                                    ) : (
                                      <label className="sc-var-upload-label">
                                        {editorUploadingIndex === 100 + idx ? (
                                          <div className="sc-spinner sc-spinner-sm" />
                                        ) : (
                                          <>
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                            <span>Add Photo</span>
                                          </>
                                        )}
                                        <input type="file" accept="image/jpeg,image/png" style={{ display: 'none' }} disabled={editorUploadingIndex !== null} onChange={(e) => void handleUploadVariationImage(idx, e)} />
                                      </label>
                                    )}
                                  </div>
                                  <div className="sc-form-group" style={{ flex: 1, position: 'relative' }}>
                                    {editorVariationEntries.length > 1 && (
                                      <button type="button" className="sc-image-remove-btn" style={{ position: 'absolute', top: '-10px', right: '-10px', width: '24px', height: '24px', zIndex: 10, background: 'rgba(0,0,0,0.5)' }} onClick={() => setEditorVariationEntries(prev => prev.filter((_, i) => i !== idx))}>
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                      </button>
                                    )}
                                    <label>Variation {idx + 1} Name</label>
                                    <input type="text" className="sc-form-input" placeholder="e.g. Mahogany Finish" value={entry.name} onChange={(e) => {
                                      const val = e.target.value
                                      setEditorVariationEntries(prev => prev.map((item, i) => i === idx ? { ...item, name: val } : item))
                                    }} />
                                    <label style={{ marginTop: '10px' }}>Variation Price</label>
                                    <input type="text" inputMode="decimal" className="sc-form-input" placeholder="₱0" value={entry.price} onChange={(e) => {
                                      const val = e.target.value.replace(/[^\d.]/g, '')
                                      setEditorVariationEntries(prev => prev.map((item, i) => i === idx ? { ...item, price: val } : item))
                                    }} />
                                  </div>
                                </div>
                              ))}
                            </div>
                            <div style={{ marginTop: '16px' }}>
                              <button type="button" className="sc-btn" onClick={() => setEditorVariationEntries(prev => [...prev, { name: "", price: "", imageUrl: null }])}>
                                + Add Variation
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Packages */}
                      <div className="sc-editor-section">
                        <label className="sc-editor-section-title">
                          Packages
                          <span className="sc-editor-section-desc">Your saved inclusions come with the casket at the selected variation price.</span>
                        </label>
                        {packageItems.length > 0 ? (
                          <div className="sc-editor-package-preview">
                            {packageItems.map(item => (
                                <div className="sc-editor-package-item" key={item.id}>
                                  {item.imageUrl ? <img src={item.imageUrl} alt={item.name} /> : <div className="sc-editor-package-empty">No image</div>}
                                  <span>{item.name}</span>
                                </div>
                            ))}
                          </div>
                        ) : (
                          <div className="sc-editor-package-note">
                            Add your own package inclusions and photos in the Packages tab to show buyers what you provide.
                          </div>
                        )}
                      </div>

                      {/* Description */}
                      <div className="sc-editor-section">
                        <div className="sc-form-group">
                          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' }}>
                            <label htmlFor="prodDesc" style={{ margin: 0 }}>Product Description</label>
                            <span style={{ fontSize: '11px', color: 'var(--sc-muted)', flexShrink: 0 }}>
                              {editorDescription.length} character{editorDescription.length === 1 ? '' : 's'}
                            </span>
                          </div>
                          <textarea
                            id="prodDesc"
                            className="sc-form-input sc-form-textarea"
                            placeholder="Describe the materials, craftsmanship, dimensions, and other services included..."
                            value={editorDescription}
                            onChange={(e) => setEditorDescription(e.target.value)}
                          />
                          <span style={{ fontSize: '11px', color: 'var(--sc-muted)', marginTop: '4px' }}>
                            A detailed description helps buyers understand your product better and improves search visibility.
                          </span>
                        </div>
                      </div>

                      {/* Form Actions */}
                      <div className="sc-editor-actions">
                        <button type="button" className="sc-btn sc-btn-secondary" disabled={saving} onClick={() => setActiveTab('products')}>Cancel</button>
                        <button type="button" className="sc-primary-btn" disabled={saving || editorUploadingIndex !== null} onClick={() => void handleSaveProduct()}>
                          {saving ? 'Saving...' : 'Save Product'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

            </div>
          )}
        </main>
      </div>{/* end sc-workspace */}

      {/* CUSTOMER HISTORY MODAL */}
      {selectedCustomer && (
        <div className='sc-modal-overlay sc-customer-modal-overlay' onClick={() => setSelectedCustomerId(null)}>
          <div className='sc-modal sc-customer-modal' role='dialog' aria-modal='true' aria-labelledby='sc-customer-modal-title' onClick={(event) => event.stopPropagation()}>
            <div className='sc-modal-header'>
              <div>
                <span className='sc-customer-eyebrow'>Customer details</span>
                <h3 id='sc-customer-modal-title'>{selectedCustomer.name}</h3>
              </div>
              <button type='button' className='sc-modal-close' aria-label='Close' onClick={() => setSelectedCustomerId(null)}>×</button>
            </div>
            <div className='sc-modal-body'>
              <div className='sc-customer-profile-head'>
                <span className='sc-customer-avatar sc-customer-avatar-lg'>{selectedCustomer.name.trim().charAt(0).toUpperCase() || 'C'}</span>
                <div>
                  <h4>{selectedCustomer.name}</h4>
                  <p>{selectedCustomer.contactNumber || 'No contact number provided'}</p>
                </div>
              </div>
              <div className='sc-summary-strip'>
                <div><strong>{selectedCustomer.arrangements.length}</strong><span>Total cases</span></div>
                <div><strong>{selectedCustomer.activeCount}</strong><span>Active cases</span></div>
                <div><strong>{formatPeso(selectedCustomer.totalValue)}</strong><span>Confirmed value</span></div>
              </div>
              <div className='sc-detail-section sc-customer-history-section'>
                <h5>Arrangement history</h5>
                {selectedCustomer.arrangements.length === 0 ? (
                  <div className='sc-empty'><p>No arrangement history for this customer.</p></div>
                ) : (
                  <div className='sc-history-list'>
                    {selectedCustomer.arrangements.map((request) => (
                      <button key={request.id} type='button' className='sc-history-row' onClick={() => { setSelectedCustomerId(null); openRequestDetail(request) }}>
                        <span className='sc-history-row-copy'>
                          <strong>{request.deceasedFullName || request.productName || 'Arrangement case'}</strong>
                          <small>{request.productName || 'Custom service'} · {formatTimestamp(request.createdAt)}</small>
                        </span>
                        <span className={`sc-status sc-status-${String(request.status || '').toLowerCase()}`}>{String(request.status || 'pending').replace(/_/g, ' ')}</span>
                        <span className='sc-row-arrow' aria-hidden='true'>›</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SHOP SCHEDULE EVENT MODAL */}
      {scheduleModalOpen && (
        <div className='sc-modal-overlay sc-schedule-modal-overlay' onClick={() => !savingScheduleEvent && setScheduleModalOpen(false)}>
          <div className='sc-modal sc-schedule-modal' role='dialog' aria-modal='true' aria-labelledby='sc-schedule-modal-title' onClick={event => event.stopPropagation()}>
            <div className='sc-modal-header'>
              <div>
                <h3 id='sc-schedule-modal-title'>{editingScheduleEvent ? 'Edit schedule event' : 'Add to schedule'}</h3>
              </div>
              <button type='button' className='sc-modal-close' aria-label='Close' disabled={savingScheduleEvent} onClick={() => setScheduleModalOpen(false)}>×</button>
            </div>
            <div className='sc-modal-body'>
              <div className='sc-schedule-form'>
                <label className='sc-schedule-field sc-schedule-field-wide'>
                  <span>Event title</span>
                  <input
                    type='text'
                    maxLength={120}
                    value={scheduleDraft.title}
                    onChange={event => setScheduleDraft(current => ({ ...current, title: event.target.value }))}
                    placeholder='Event name'
                    autoFocus
                  />
                </label>
                <label className='sc-schedule-field'>
                  <span>Event type</span>
                  <select value={scheduleDraft.eventType} onChange={event => setScheduleDraft(current => ({ ...current, eventType: event.target.value as ShopScheduleEventType }))}>
                    {SCHEDULE_EVENT_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
                  </select>
                </label>
                <label className='sc-schedule-field'>
                  <span>Date</span>
                  <input type='date' value={scheduleDraft.eventDate} onChange={event => setScheduleDraft(current => ({ ...current, eventDate: event.target.value }))} />
                </label>
                <label className='sc-schedule-field'>
                  <span>Start time</span>
                  <input type='time' value={scheduleDraft.startTime} onChange={event => setScheduleDraft(current => ({ ...current, startTime: event.target.value }))} />
                </label>
                <label className='sc-schedule-field'>
                  <span>End time <small>Optional</small></span>
                  <input type='time' value={scheduleDraft.endTime} onChange={event => setScheduleDraft(current => ({ ...current, endTime: event.target.value }))} />
                </label>
                <label className='sc-schedule-field sc-schedule-field-wide'>
                  <span>Location <small>Optional</small></span>
                  <input type='text' maxLength={180} value={scheduleDraft.location} onChange={event => setScheduleDraft(current => ({ ...current, location: event.target.value }))} placeholder='Location' />
                </label>
                <label className='sc-schedule-field sc-schedule-field-wide'>
                  <span>Notes <small>Optional</small></span>
                  <textarea maxLength={500} rows={3} value={scheduleDraft.notes} onChange={event => setScheduleDraft(current => ({ ...current, notes: event.target.value }))} placeholder='Notes' />
                </label>
              </div>
            </div>
            <div className='sc-schedule-modal-actions'>
              {editingScheduleEvent && <button type='button' className='sc-schedule-delete-btn' disabled={savingScheduleEvent} onClick={removeScheduleEvent}>Delete</button>}
              <span />
              <button type='button' className='sc-btn' disabled={savingScheduleEvent} onClick={() => setScheduleModalOpen(false)}>Cancel</button>
              <button type='button' className='sc-btn sc-btn-primary' disabled={savingScheduleEvent} onClick={() => void saveScheduleEvent()}>{savingScheduleEvent ? 'Saving…' : editingScheduleEvent ? 'Save changes' : 'Add event'}</button>
            </div>
          </div>
        </div>
      )}

      {/* PRODUCT DETAIL MODAL */}
      {selectedProduct && (
        <div className="sc-modal-overlay sc-product-modal-overlay" onClick={() => setSelectedProduct(null)}>
          <div
            className="sc-modal sc-product-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sc-product-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="sc-product-modal-header">
              <div>
                <span>Product catalog</span>
                <h3 id="sc-product-modal-title">Product details</h3>
              </div>
              <button type="button" className="sc-modal-close" aria-label="Close product details" onClick={() => setSelectedProduct(null)}>×</button>
            </header>

            <div className="sc-product-modal-scroll">
              <section className="sc-product-modal-overview">
                <div className="sc-product-detail-gallery">
                  <button
                    type="button"
                    className="sc-gallery-main"
                    disabled={!mainImage}
                    onClick={() => mainImage && setLightboxOpen(true)}
                    aria-label={mainImage ? 'View product image full size' : 'No product image available'}
                  >
                    {mainImage ? (
                      <img src={mainImage} alt={selectedProduct.name} />
                    ) : (
                      <div className="sc-gallery-main-ph">LC</div>
                    )}
                    {mainImage && <span className="sc-product-image-hint">View larger</span>}
                  </button>
                  {galleryImages.length > 1 && (
                    <div className="sc-gallery-thumbs">
                      {galleryImages.map((url, idx) => (
                        <button
                          type="button"
                          key={url}
                          className={`sc-gallery-thumb ${idx === galleryIndex ? 'active' : ''}`}
                          onClick={() => setGalleryIndex(idx)}
                          aria-label={`Show product image ${idx + 1}`}
                        >
                          <img src={url} alt="" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="sc-product-modal-info">
                  <span className="sc-product-modal-eyebrow">Item #{selectedProduct.id.slice(0, 8).toUpperCase()}</span>
                  <div className="sc-product-modal-title-row">
                    <h2>{selectedProduct.name}</h2>
                    <span className={`sc-product-availability ${!selectedProduct.active ? 'is-paused' : selectedProduct.stock > 0 ? 'is-live' : 'is-soldout'}`}>
                      {!selectedProduct.active ? 'Paused' : selectedProduct.stock > 0 ? 'Live' : 'Sold out'}
                    </span>
                  </div>
                  <div className="sc-product-detail-price">{formatPeso(selectedProduct.price)}</div>

                  <dl className="sc-product-modal-facts">
                    <div><dt>Available stock</dt><dd>{selectedProduct.stock}</dd></div>
                    <div><dt>Variations</dt><dd>{selectedProduct.hasVariations ? selectedProduct.variationCount : 'None'}</dd></div>
                    <div><dt>Photos</dt><dd>{galleryImages.length}</dd></div>
                    <div><dt>Added</dt><dd>{selectedProduct.createdAt ? new Date(selectedProduct.createdAt).toLocaleDateString() : '—'}</dd></div>
                  </dl>

                  <div className="sc-product-modal-description">
                    <h4>Description</h4>
                    <p>{selectedProduct.description || 'No product description has been added.'}</p>
                  </div>
                </div>
              </section>

              {detailLoading && (
                <div className="sc-product-modal-loading">
                  <div className="sc-spinner" />
                  <p>Loading product details…</p>
                </div>
              )}

              {detailError && <p className="sc-rejection">{detailError}</p>}

              {detailData && detailData.variations.length > 0 && (
                <section className="sc-product-modal-section">
                  <div className="sc-product-modal-section-head">
                    <div><span>Options</span><h4>Product variations</h4></div>
                    <small>{detailData.variations.length} variation{detailData.variations.length === 1 ? '' : 's'}</small>
                  </div>
                  <div className="sc-var-list">
                    {detailData.variations.map((v) => (
                      <div className="sc-var-item" key={v.id}>
                        {v.imageUrl ? <img src={v.imageUrl} alt={v.name} /> : <div className="sc-var-ph">LC</div>}
                        <span>{v.name}{v.price ? ` · ${formatPeso(v.price)}` : ''}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {detailData && (
                <section className="sc-product-modal-section">
                  <div className="sc-product-modal-section-head">
                    <div><span>Customer response</span><h4>Ratings and feedback</h4></div>
                    <small>{detailData.feedbackCount} feedback</small>
                  </div>
                  <div className="sc-product-review-layout">
                    <div className="sc-rating-summary">
                      <span className="sc-rating-score">
                        {detailData.ratingCount ? detailData.averageRating.toFixed(1) : '—'}
                      </span>
                      <div>
                        <Stars value={detailData.averageRating} />
                        <div className="sc-rating-meta">
                          {detailData.ratingCount} rating{detailData.ratingCount === 1 ? '' : 's'}
                        </div>
                      </div>
                    </div>

                    {detailData.feedbacks.length === 0 ? (
                      <div className="sc-product-feedback-empty">No customer feedback yet.</div>
                    ) : (
                      <div className="sc-feedback-list">
                        {detailData.feedbacks.map((fb) => (
                          <article className="sc-feedback-item" key={fb.id}>
                            <div className="sc-feedback-item-head">
                              <span className="sc-feedback-author">{fb.displayName || fb.userEmail || 'Anonymous'}</span>
                              <span className="sc-feedback-date">
                                {fb.createdAt ? new Date(fb.createdAt).toLocaleDateString() : ''}
                              </span>
                            </div>
                            {fb.ratingSnapshot ? (
                              <div className="sc-feedback-stars"><Stars value={fb.ratingSnapshot} /></div>
                            ) : null}
                            <p className="sc-feedback-text">{fb.feedback}</p>
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              )}
            </div>

            <footer className="sc-product-modal-footer">
              <button
                type="button"
                className="sc-product-delete-action"
                disabled={saving}
                onClick={() => {
                  const p = selectedProduct
                  setSelectedProduct(null)
                  handleDeleteProduct(p)
                }}
              >
                Delete product
              </button>
              <div>
                <button type="button" className="sc-btn sc-btn-secondary" onClick={() => setSelectedProduct(null)}>Close</button>
                <button
                  type="button"
                  className="sc-btn sc-btn-secondary"
                  onClick={() => {
                    const productId = selectedProduct.id
                    setSelectedProduct(null)
                    navigate(`/funeral/product/${productId}`)
                  }}
                >
                  View storefront
                </button>
                <button
                  type="button"
                  className="sc-btn sc-btn-primary"
                  disabled={saving}
                  onClick={() => {
                    const p = selectedProduct
                    setSelectedProduct(null)
                    void openProductEditor(p.id)
                  }}
                >
                  Edit product
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}

      {/* SERVICE REQUEST DETAIL MODAL */}
      {viewRequest && (() => {
        const r = viewRequest
        const status = String(r.status || '').toLowerCase()
        const paymentReceipt = getFamilyPaymentReceipt(r)
        const isProviderReceipt = paymentReceipt.source === 'provider'
        const providerLabel = String(r.paymentProvider || '').toLowerCase() === 'paymongo' ? 'PayMongo' : 'Xendit'
        const rawProviderMethod = r.providerPaymentMethod || r.payoutChannelCode || ''
        const providerMethodLabel = r.payoutChannelCode
          ? getPayoutChannelLabel(r.payoutChannelCode)
          : String(rawProviderMethod).replace(/^PH_/, '').replace(/_/g, ' ')
        const statusLabel = String(r.status || 'pending').replace(/_/g, ' ').replace(/\\b\\w/g, letter => letter.toUpperCase())
        const requestTypeLabel = r.requestType?.replace(/_/g, ' ').replace(/\\b\\w/g, letter => letter.toUpperCase()) || 'Standard service'
        const showPayment = ['awaiting_payment', 'payment_submitted', 'payment_verified', 'awaiting_customer_confirmation', 'completed'].includes(status) && (
          r.paymentAmount != null || r.paymentPayerName || r.paymentGcashName || r.paymentGcashNumber || r.paymentReferenceNumber || r.paymentProofImageUrl || r.paymentSubmittedAt || isProviderReceipt
        )
        const hasSchedule = Boolean(
          r.wakeAddress || r.churchName || r.cemeteryName
          || r.wakeStartDate || r.wakeEndDate || r.burialTime || r.pickupAddress
        )
        const timelineItems = [
          { label: 'Request created', value: r.createdAt },
          { label: 'Shop responded', value: r.shopRespondedAt },
          { label: 'Accepted', value: r.acceptedAt },
          { label: 'Declined', value: r.declinedAt },
          { label: 'Cancelled', value: r.cancelledAt },
          { label: 'Payment submitted', value: r.paymentSubmittedAt },
          { label: 'Payment verified', value: r.paymentVerifiedAt },
          { label: 'Completed', value: r.completedAt },
        ].filter(item => Boolean(item.value))
        return (
          <div className="sc-modal-overlay" onClick={() => setViewRequest(null)}>
            <div className="sc-modal sc-request-modal" role="dialog" aria-modal="true" aria-labelledby="sc-request-title" onClick={(e) => e.stopPropagation()}>
              <div className="sc-modal-header sc-request-modal-header">
                <div>
                  <span className="sc-request-eyebrow">Arrangement case #{r.id.slice(0, 8).toUpperCase()}</span>
                  <h3 id="sc-request-title">Service request</h3>
                </div>
                <div className="sc-request-header-actions">
                  <span className={`sc-status sc-status-${status}`}>{statusLabel}</span>
                  <button type="button" className="sc-modal-close" aria-label="Close" onClick={() => setViewRequest(null)}>×</button>
                </div>
              </div>
              <div className="sc-modal-body sc-request-modal-body">
                <div className="sc-product-detail-hero">
                  {r.productImageUrl ? (
                    <div className="sc-product-detail-gallery">
                      <button
                        type="button"
                        className="sc-gallery-main"
                        onClick={() => setProofLightboxUrl(r.productImageUrl as string)}
                        aria-label="View product image"
                      >
                        <img src={r.productImageUrl} alt={r.productName || 'Product'} />
                      </button>
                    </div>
                  ) : (
                    <div className="sc-product-detail-gallery">
                      <div className="sc-gallery-main-ph">LC</div>
                    </div>
                  )}
                  <div className="sc-product-detail-info">
                    <span className="sc-request-product-label">{requestTypeLabel}</span>
                    <h4>{r.productName || 'Custom Casket'}</h4>
                    {r.variationName && <div className="sc-request-variation">Variation: {r.variationName}</div>}
                    {r.packageItems?.length ? <div className="sc-request-variation">Packages: {r.packageItems.join(', ')}</div> : null}
                    {isCustomCasketRequest(r) && status === 'pending_shop_acceptance' ? (
                      <div className="sc-custom-price-editor sc-custom-price-editor-modal">
                        <label htmlFor={`custom-price-modal-${r.id}`}>Custom casket price</label>
                        <div className="sc-custom-price-input-wrap">
                          <span aria-hidden="true">₱</span>
                          <input
                            id={`custom-price-modal-${r.id}`}
                            type="number"
                            min="1"
                            max="999999999.99"
                            step="0.01"
                            inputMode="decimal"
                            placeholder="Enter final price"
                            value={customPriceDrafts[r.id] ?? ''}
                            onChange={event => setCustomPriceDrafts(current => ({ ...current, [r.id]: event.target.value }))}
                          />
                        </div>
                        <small>The price is saved only after acceptance. Payment opens for the customer next.</small>
                      </div>
                    ) : (
                      <div className="sc-product-detail-price">{formatPeso(r.productPrice)}</div>
                    )}
                  </div>
                </div>

                <div className="sc-request-info-grid">
                  <section className="sc-request-info-card">
                    <div className="sc-request-section-head">
                      <span aria-hidden="true">
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
                      </span>
                      <div><h4>Family contact</h4><p>Primary requestor details</p></div>
                    </div>
                    <dl className="sc-request-data-list">
                      <div><dt>Requestor</dt><dd>{r.familyCoordinatorName || r.requesterName || 'Not provided'}</dd></div>
                      <div><dt>Contact number</dt><dd>{r.contactNumber || 'Not provided'}</dd></div>
                    </dl>
                  </section>

                  <section className="sc-request-info-card">
                    <div className="sc-request-section-head">
                      <span aria-hidden="true">
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 3h16v18H4z" /><path d="M8 7h8M8 11h8M8 15h5" /></svg>
                      </span>
                      <div><h4>Service information</h4><p>Deceased and arrangement information</p></div>
                    </div>
                    <dl className="sc-request-data-list">
                      <div><dt>Request type</dt><dd>{requestTypeLabel}</dd></div>
                      <div><dt>Deceased</dt><dd>{r.deceasedFullName || 'Not provided'}</dd></div>
                      {r.deceasedDateOfBirth && <div><dt>Date of birth</dt><dd>{new Date(r.deceasedDateOfBirth).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}</dd></div>}
                      {r.deceasedDateOfPassing && <div><dt>Date of passing</dt><dd>{new Date(r.deceasedDateOfPassing).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}</dd></div>}
                      {r.deceasedAge != null && <div><dt>Age</dt><dd>{r.deceasedAge}</dd></div>}
                    </dl>
                    {r.memorialPhotoUrl && (
                      <button type="button" className="sc-request-memorial" onClick={() => setProofLightboxUrl(r.memorialPhotoUrl as string)}>
                        <img src={r.memorialPhotoUrl} alt="Memorial" />
                        <span>View memorial photo</span>
                      </button>
                    )}
                  </section>

                  {hasSchedule && (
                    <section className="sc-request-info-card sc-request-info-wide">
                      <div className="sc-request-section-head">
                        <span aria-hidden="true">
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>
                        </span>
                        <div><h4>Schedule and logistics</h4><p>Wake, burial, and pickup information</p></div>
                      </div>
                      <dl className="sc-request-data-list sc-request-data-columns">
                        {r.wakeAddress && <div><dt>Wake venue</dt><dd>{r.wakeAddress}</dd></div>}
                        {r.churchName && <div><dt>Church / chapel</dt><dd>{r.churchName}</dd></div>}
                        {r.cemeteryName && <div><dt>Cemetery</dt><dd>{r.cemeteryName}</dd></div>}
                        {(r.wakeStartDate || r.wakeEndDate) && <div><dt>Wake schedule</dt><dd>{formatScheduleDate(r.wakeStartDate)} to {formatScheduleDate(r.wakeEndDate)}</dd></div>}
                        {r.burialTime && <div><dt>Burial time</dt><dd>{formatScheduleTime(r.burialTime)}</dd></div>}
                        {r.pickupAddress && <div><dt>Pickup address</dt><dd>{r.pickupAddress}</dd></div>}
                      </dl>
                    </section>
                  )}

                  <section className="sc-request-info-card sc-request-info-wide">
                    <div className="sc-request-section-head">
                      <span aria-hidden="true">
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                      </span>
                      <div><h4>Case timeline</h4><p>Recorded milestones for this request</p></div>
                    </div>
                    <ol className="sc-request-timeline">
                      {timelineItems.map((item, index) => (
                        <li key={item.label} className={index === timelineItems.length - 1 ? 'current' : ''}>
                          <span aria-hidden="true" />
                          <div><strong>{item.label}</strong><time>{formatTimestamp(item.value)}</time></div>
                        </li>
                      ))}
                    </ol>
                  </section>
                </div>

                <div className="sc-detail-grid sc-request-legacy-details">
                  <div className="sc-detail"><span>Request Type</span><strong>{r.requestType?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || '—'}</strong></div>
                  <div className="sc-detail"><span>Contact Number</span><strong>{r.contactNumber || '—'}</strong></div>
                  <div className="sc-detail"><span>Requestor</span><strong>{r.familyCoordinatorName || r.requesterName || '—'}</strong></div>
                  <div className="sc-detail"><span>Deceased Full Name</span><strong>{r.deceasedFullName || '—'}</strong></div>
                  <div className="sc-detail"><span>Deceased Date of Birth</span><strong>{r.deceasedDateOfBirth ? new Date(r.deceasedDateOfBirth).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) : '—'}</strong></div>
                  <div className="sc-detail"><span>Date of Passing</span><strong>{r.deceasedDateOfPassing ? new Date(r.deceasedDateOfPassing).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) : '—'}</strong></div>
                  <div className="sc-detail"><span>Deceased Age</span><strong>{r.deceasedAge != null ? r.deceasedAge : '—'}</strong></div>
                  <div className="sc-detail"><span>Wake Venue</span><strong>{r.wakeAddress || '—'}</strong></div>
                  <div className="sc-detail">
                    <span>Wake Schedule</span>
                    <strong>
                      {r.wakeStartDate || r.wakeEndDate
                        ? `${formatScheduleDate(r.wakeStartDate)} to ${formatScheduleDate(r.wakeEndDate)}`
                        : '—'}
                    </strong>
                  </div>
                  <div className="sc-detail"><span>Burial Time</span><strong>{formatScheduleTime(r.burialTime)}</strong></div>
                  <div className="sc-detail"><span>Pickup Address</span><strong>{r.pickupAddress || '—'}</strong></div>
                  <div className="sc-detail"><span>Created</span><strong>{formatTimestamp(r.createdAt)}</strong></div>
                  <div className="sc-detail"><span>Accepted At</span><strong>{formatTimestamp(r.acceptedAt)}</strong></div>
                  <div className="sc-detail"><span>Declined At</span><strong>{formatTimestamp(r.declinedAt)}</strong></div>
                  <div className="sc-detail"><span>Cancelled At</span><strong>{formatTimestamp(r.cancelledAt)}</strong></div>
                  <div className="sc-detail"><span>Shop Responded At</span><strong>{formatTimestamp(r.shopRespondedAt)}</strong></div>
                  <div className="sc-detail"><span>Completed At</span><strong>{formatTimestamp(r.completedAt)}</strong></div>
                </div>

                {r.customDesignNotes ? (
                  <div className="sc-detail-section sc-request-note-card">
                    <h5>Custom Design Notes</h5>
                    <p>{r.customDesignNotes}</p>
                  </div>
                ) : null}

                {r.tributeMessage ? (
                  <div className="sc-detail-section sc-request-note-card">
                    <h5>Tribute Message</h5>
                    <p>{r.tributeMessage}</p>
                  </div>
                ) : null}

                {showPayment && (
                  <div className="sc-pd-card">
                    <div className="sc-pd-head">
                      <div className="sc-pd-head-icon">
                        <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
                          <rect x="2" y="5" width="20" height="14" rx="3" stroke="currentColor" strokeWidth="1.8" />
                          <line x1="2" y1="10" x2="22" y2="10" stroke="currentColor" strokeWidth="1.8" />
                        </svg>
                      </div>
                      <div className="sc-pd-head-copy">
                        <h5>Family Payment</h5>
                        <span>Payment the requester sent for this service request.</span>
                      </div>
                      <span className={`sc-status sc-status-${status}`}>
                        {(r.status || 'pending').replace(/_/g, ' ')}
                      </span>
                    </div>

                    {Number(r.paymentAmount) > 0 ? (
                      <div className="sc-pd-amount">
                        <span>Amount to receive</span>
                        <strong>{formatPeso(r.paymentAmount)}</strong>
                      </div>
                    ) : null}

                    <div className="sc-pd-details">
                      {isProviderReceipt ? (
                        <>
                          <div className="sc-pd-row"><span>Payment Method</span><strong>{providerLabel}{providerMethodLabel ? ` · ${providerMethodLabel}` : ''}</strong></div>
                          <div className="sc-pd-row"><span>Provider Reference</span><strong>{r.providerPaymentId || r.providerReferenceId || r.id}</strong></div>
                          <div className="sc-pd-row"><span>Paid At</span><strong>{formatTimestamp(r.providerPaymentCompletedAt || r.paymentVerifiedAt || r.paymentSubmittedAt)}</strong></div>
                          <div className="sc-pd-row"><span>Verification</span><strong>Confirmed automatically</strong></div>
                        </>
                      ) : (
                        <>
                          <div className="sc-pd-row"><span>Sender Name</span><strong>{r.paymentPayerName || '—'}</strong></div>
                          <div className="sc-pd-row"><span>GCash Name</span><strong>{r.paymentGcashName || '—'}</strong></div>
                          <div className="sc-pd-row"><span>GCash Number</span><strong>{r.paymentGcashNumber || '—'}</strong></div>
                          <div className="sc-pd-row"><span>Reference Number</span><strong>{r.paymentReferenceNumber || '—'}</strong></div>
                          <div className="sc-pd-row"><span>Submitted At</span><strong>{formatTimestamp(r.paymentSubmittedAt)}</strong></div>
                          {r.paymentVerifiedAt && <div className="sc-pd-row"><span>Verified At</span><strong>{formatTimestamp(r.paymentVerifiedAt)}</strong></div>}
                        </>
                      )}
                    </div>

                    {r.paymentProofImageUrl && (
                      <div className="sc-pd-proof">
                        <div className="sc-pd-label">Proof of Payment</div>
                        <button
                          type="button"
                          className="sc-pd-proof-btn"
                          aria-label="View payment proof full size"
                          title="Click to view full size"
                          onClick={() => setProofLightboxUrl(r.paymentProofImageUrl as string)}
                        >
                          <img src={r.paymentProofImageUrl} alt="Payment proof" />
                        </button>
                      </div>
                    )}

                    {isProviderReceipt && (
                      <div className="sc-pd-digital-receipt">
                        <FamilyPaymentIcon name="check" />
                        <div><strong>Provider-confirmed payment</strong><span>{providerLabel} verified this transaction. No receipt image upload is required.</span></div>
                      </div>
                    )}

                    {r.paymentRejectionReason && (
                      <div className="sc-pd-reject">
                        <strong>Rejection Reason</strong>
                        <span>{r.paymentRejectionReason}</span>
                      </div>
                    )}
                  </div>
                )}

                {status === 'payment_verified' && (
                  <div className="sc-detail-section sc-request-completion-card">
                    <h5>Completion Proof</h5>
                    {completionProofPreview ? (
                      <>
                        <img
                          src={completionProofPreview}
                          alt="Completion proof preview"
                          className="sc-payment-proof-thumb"
                          style={{ width: '140px', height: '140px', objectFit: 'contain', background: '#fff' }}
                          onClick={() => setProofLightboxUrl(completionProofPreview)}
                        />
                        <div style={{ marginTop: '8px' }}>
                          <button type="button" className="sc-btn sc-btn-sm sc-btn-danger" onClick={clearCompletionProofSelection} disabled={uploadingCompletionProof}>
                            Remove Proof
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <label className="sc-btn sc-btn-secondary" style={{ cursor: 'pointer' }}>
                          {uploadingCompletionProof ? 'Uploading…' : 'Attach Completion Proof'}
                          <input
                            type="file"
                            accept="image/*"
                            style={{ display: 'none' }}
                            disabled={uploadingCompletionProof}
                            onChange={(e) => void handleCompletionProofFileChange(e)}
                          />
                        </label>
                        <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--sc-muted)' }}>
                          A photo proof is required before this request can be marked as delivered. The family will then confirm it as done.
                        </div>
                      </>
                    )}
                  </div>
                )}

                {status === 'awaiting_customer_confirmation' && (
                  <div className="sc-request-waiting-note">
                    <strong>Awaiting Customer Confirmation</strong> — the family is reviewing your completion proof and will confirm the request as done.
                  </div>
                )}

                {status === 'awaiting_customer_confirmation' && (
                  <div
                    className="sc-detail-section"
                    style={{
                      marginTop: '12px',
                      borderLeft: `4px solid ${r.completionProofSeenAt ? 'var(--sc-success)' : 'var(--sc-muted)'}`,
                    }}
                  >
                    <h5>{r.completionProofSeenAt ? 'Read Receipt: Seen by the family' : 'Read Receipt: Delivered but not yet seen'}</h5>
                    {r.completionProofSeenAt ? (
                      <p style={{ margin: 0, fontSize: '13px', color: 'var(--sc-muted)' }}>
                        The family opened this request and viewed your completion proof on{' '}
                        {formatTimestamp(r.completionProofSeenAt)}. You can follow up with them if needed.
                      </p>
                    ) : (
                      <p style={{ margin: 0, fontSize: '13px', color: 'var(--sc-muted)' }}>
                        Once the family opens the request and views your completion proof, the exact time will appear here.
                      </p>
                    )}
                  </div>
                )}

                {r.completionProofImageUrl && (
                  <div className="sc-detail-section">
                    <h5>Completion Proof</h5>
                    <img
                      src={r.completionProofImageUrl}
                      alt="Completion proof"
                      className="sc-payment-proof-thumb"
                      style={{ width: '140px', height: '140px', objectFit: 'contain', background: '#fff', cursor: 'zoom-in' }}
                      onClick={() => setProofLightboxUrl(r.completionProofImageUrl as string)}
                    />
                  </div>
                )}

                <div className="sc-editor-actions sc-request-actions">
                  <button type="button" className="sc-btn sc-btn-secondary" onClick={() => setViewRequest(null)}>Close</button>
                  {status === 'pending_shop_acceptance' && (
                    <>
                      <button
                        type="button"
                        className="sc-btn"
                        style={{ borderColor: 'var(--sc-success)', color: 'var(--sc-success)' }}
                        disabled={saving}
                        onClick={() => { setViewRequest(null); void handleUpdateStatus(r, 'accepted_by_shop') }}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="sc-btn sc-btn-danger"
                        disabled={saving}
                        onClick={() => { setViewRequest(null); void handleUpdateStatus(r, 'declined_by_shop') }}
                      >
                        Decline
                      </button>
                    </>
                  )}
                  {status === 'payment_submitted' && (
                    <>
                      <button
                        type="button"
                        className="sc-btn"
                        style={{ borderColor: 'var(--sc-success)', color: 'var(--sc-success)' }}
                        disabled={saving || paymentVerifyingId === r.id}
                        onClick={() => { setViewRequest(null); void handleVerifyPayment(r, 'verified') }}
                      >
                        Verify Payment
                      </button>
                      <button
                        type="button"
                        className="sc-btn sc-btn-danger"
                        disabled={saving || paymentVerifyingId === r.id}
                        onClick={() => { setViewRequest(null); void handleVerifyPayment(r, 'rejected') }}
                      >
                        Reject Payment
                      </button>
                    </>
                  )}
                  {status === 'payment_verified' && (
                    <button
                      type="button"
                      className="sc-btn"
                      style={{ borderColor: 'var(--sc-success)', color: 'var(--sc-success)' }}
                      disabled={saving || uploadingCompletionProof}
                      onClick={() => {
                        if (!completionProofFile) {
                          openAlert({ title: 'Proof Required', message: 'Attach a completion proof photo before marking this request as completed.', tone: 'warning', okLabel: 'Got It' })
                          return
                        }
                        setViewRequest(null)
                        void handleMarkCompleted(r)
                      }}
                    >
                      {uploadingCompletionProof ? 'Uploading…' : 'Mark Completed'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* PRODUCT GALLERY LIGHTBOX */}
      {lightboxOpen && mainImage && (
        <div className="sc-lightbox" onClick={() => setLightboxOpen(false)}>
          <button type="button" className="sc-lightbox-close" aria-label="Close image" onClick={() => setLightboxOpen(false)}>×</button>
          <button
            type="button"
            className="sc-lightbox-nav sc-lightbox-prev"
            aria-label="Previous image"
            onClick={(e) => { e.stopPropagation(); setGalleryIndex((prev) => (prev > 0 ? prev - 1 : galleryImages.length - 1)) }}
          >‹</button>
          <img src={mainImage} alt="Product" className="sc-lightbox-img" onClick={(e) => e.stopPropagation()} />
          <button
            type="button"
            className="sc-lightbox-nav sc-lightbox-next"
            aria-label="Next image"
            onClick={(e) => { e.stopPropagation(); setGalleryIndex((prev) => (prev < galleryImages.length - 1 ? prev + 1 : 0)) }}
          >›</button>
          <span className="sc-lightbox-counter">{galleryIndex + 1} / {galleryImages.length}</span>
        </div>
      )}

      {/* SIMPLE IMAGE LIGHTBOX (proof / memorial / product) */}
      {proofLightboxUrl && (
        <div className="sc-lightbox" onClick={() => setProofLightboxUrl(null)}>
          <button type="button" className="sc-lightbox-close" aria-label="Close image" onClick={() => setProofLightboxUrl(null)}>×</button>
          <img src={proofLightboxUrl} alt="Enlarged image" className="sc-lightbox-img" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {alertDialog}
      {confirmDialog}
    </div>
  )
}
