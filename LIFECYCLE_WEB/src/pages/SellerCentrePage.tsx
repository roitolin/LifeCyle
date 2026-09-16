import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  paymentQrUrl: string | null
  serviceFeeAmount: number | string | null
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

type ShopPackage = {
  id?: string
  shopId?: string
  flowersImageUrl?: string | null
  candlesImageUrl?: string | null
  curtainsImageUrl?: string | null
  vehicleImageUrl?: string | null
  active: boolean
  createdAt?: string | null
  updatedAt?: string | null
}

type PackageField = 'flowersImageUrl' | 'candlesImageUrl' | 'curtainsImageUrl' | 'vehicleImageUrl'

const SHOP_PACKAGE_ITEMS: { key: string; label: string; field: PackageField }[] = [
  { key: 'flowers', label: 'Flowers', field: 'flowersImageUrl' },
  { key: 'candles', label: 'Candles', field: 'candlesImageUrl' },
  { key: 'curtains', label: 'Curtains', field: 'curtainsImageUrl' },
  { key: 'vehicle', label: 'Vehicle', field: 'vehicleImageUrl' },
]

type ServiceRequest = {
  id: string
  requesterId: string
  productId: string
  productName: string
  productPrice?: string
  productImageUrl?: string | null
  variationName?: string | null
  packageItems?: string[] | null
  requestType?: string
  customDesignNotes?: string | null
  deceasedFullName: string
  deceasedDateOfBirth?: string | null
  deceasedDateOfPassing?: string | null
  deceasedAge?: number | null
  tributeMessage: string
  contactNumber: string
  status: string
  paymentQrUrl?: string | null
  paymentAmount?: number | string | null
  paymentPayerName?: string | null
  paymentGcashName?: string | null
  paymentGcashNumber?: string | null
  paymentReferenceNumber?: string | null
  paymentProofImageUrl?: string | null
  paymentRejectionReason?: string | null
  paymentSubmittedAt?: string | null
  paymentVerifiedAt?: string | null
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
  imageUrl: string | null
}

type ProductVariationDetail = {
  id: string
  name: string
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

function formatPeso(value: number | string | null | undefined): string {
  const num = Number(String(value ?? '').replace(/[^\d.]/g, ''))
  if (!Number.isFinite(num) || num <= 0) return value ? String(value) : '—'
  return `₱${new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 }).format(num)}`
}

function formatCompactPeso(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '\\u20b10'
  return `\\u20b1${new Intl.NumberFormat('en-PH', {
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
  const [activeTab, setActiveTab] = useState<'dashboard' | 'products' | 'packages' | 'orders' | 'customers' | 'calendar' | 'reports' | 'payments' | 'admin_payments' | 'shop' | 'payment_setup' | 'product_editor'>(() => (
    searchParams.get('tab') === 'orders' ? 'orders' : 'dashboard'
  ))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [productTab, setProductTab] = useState<'all' | 'live' | 'soldout'>('all')
  const [saving, setSaving] = useState(false)
  const [uploadingShopProfile, setUploadingShopProfile] = useState(false)
  const [uploadingShopCover, setUploadingShopCover] = useState(false)
  const [payment, setPayment] = useState<ShopPayment | null>(null)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notifications, setNotifications] = useState<SellerNotification[]>([])
  const [sidebarExpanded, setSidebarExpanded] = useState<Record<string, boolean>>({ order: true, product: true, finance: true, setting: true })
  const [paymentVerifyingId, setPaymentVerifyingId] = useState('')
  const [customerSearch, setCustomerSearch] = useState('')
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)

  // Product details viewer
  const [selectedProduct, setSelectedProduct] = useState<ShopProduct | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailData, setDetailData] = useState<ProductDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [galleryIndex, setGalleryIndex] = useState(0)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  // Service request details viewer
  const [viewRequest, setViewRequest] = useState<ServiceRequest | null>(null)
  const [proofLightboxUrl, setProofLightboxUrl] = useState<string | null>(null)

  // Completion proof upload (required before marking a request completed)
  const completionProofFileInputRef = useRef<HTMLInputElement | null>(null)
  const [completionProofFile, setCompletionProofFile] = useState<File | null>(null)
  const [completionProofPreview, setCompletionProofPreview] = useState<string | null>(null)
  const [uploadingCompletionProof, setUploadingCompletionProof] = useState(false)

  // Payment QR & Amount states
  const paymentQrFileInputRef = useRef<HTMLInputElement | null>(null)
  const [paymentQrUrl, setPaymentQrUrl] = useState<string | null>(null)
  const [paymentFeeInput, setPaymentFeeInput] = useState('')
  const [paymentQrFile, setPaymentQrFile] = useState<File | null>(null)
  const [paymentQrPreview, setPaymentQrPreview] = useState<string | null>(null)
  const [paymentSaving, setPaymentSaving] = useState(false)
  const [paymentQrSavedAt, setPaymentQrSavedAt] = useState<string | null>(null)

  // Product Editor States
  const [editingProductId, setEditingProductId] = useState<string | null>(null)
  const [editorLoading, setEditorLoading] = useState(false)
  const [editorName, setEditorName] = useState("")
  const [editorPrice, setEditorPrice] = useState("")
  const [editorStock, setEditorStock] = useState("1")
  const [editorHasVariations, setEditorHasVariations] = useState(false)
  const [editorVariationEntries, setEditorVariationEntries] = useState<ProductVariation[]>([])
  const [editorDescription, setEditorDescription] = useState("")
  const [editorImages, setEditorImages] = useState<(string | null)[]>(Array(5).fill(null))
  const [editorUploadingIndex, setEditorUploadingIndex] = useState<number | null>(null)
  const [packageSaving, setPackageSaving] = useState(false)
  const [uploadingPackageField, setUploadingPackageField] = useState<PackageField | null>(null)

  const openProductEditor = async (productId: string | null) => {
    setEditingProductId(productId)
    setActiveTab('product_editor')
    if (!productId) {
      setEditorName("")
      setEditorPrice("")
      setEditorStock("1")
      setEditorHasVariations(false)
      setEditorVariationEntries([{ name: "", imageUrl: null }])
      setEditorDescription("")
      setEditorImages(Array(5).fill(null))
      return
    }

    setEditorLoading(true)
    try {
      const { data, error } = await supabase
        .from('funeral_products')
        .select(`
          *,
          funeral_product_variations ( id, name, imageUrl ),
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
          .map((img: any) => img.imageUrl)
        const normalizedImages = Array(5).fill(null)
        galleryImageUrls.slice(0, 5).forEach((url: string, idx: number) => {
          normalizedImages[idx] = url
        })
        setEditorImages(normalizedImages)

        const vars = (data.funeral_product_variations || []).map((v: any) => ({
          name: v.name || "",
          imageUrl: v.imageUrl || null
        }))
        setEditorVariationEntries(vars.length > 0 ? vars : [{ name: "", imageUrl: null }])
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

  const handlePaymentQrFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0]
    if (!selected) return

    if (!selected.type.startsWith('image/')) {
      openAlert({ title: 'Invalid File', message: 'Please choose an image file for the payment QR code.', tone: 'warning', okLabel: 'Got It' })
      return
    }

    if (paymentQrPreview) URL.revokeObjectURL(paymentQrPreview)
    setPaymentQrFile(selected)
    setPaymentQrPreview(URL.createObjectURL(selected))
  }

  const clearPaymentQrSelection = () => {
    if (paymentQrPreview) URL.revokeObjectURL(paymentQrPreview)
    setPaymentQrFile(null)
    setPaymentQrPreview(null)
    if (paymentQrFileInputRef.current) paymentQrFileInputRef.current.value = ''
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

  const handleSavePaymentSettings = async () => {
    if (!user || paymentSaving) return

    const parsedFee = Number(String(paymentFeeInput).replace(/[^\d.]/g, ''))
    if (!String(paymentFeeInput).trim() || !Number.isFinite(parsedFee) || parsedFee <= 0) {
      openAlert({ title: 'Invalid Amount', message: 'Please enter a valid service fee amount your requesters must send.', tone: 'warning', okLabel: 'Got It' })
      return
    }

    setPaymentSaving(true)
    try {
      let finalQrUrl = paymentQrUrl

      if (paymentQrFile) {
        const ext = paymentQrFile.name.split('.').pop() || 'png'
        const path = `payment-qr/shop_${user.id}_${Date.now()}.${ext}`
        const { error: uploadError } = await supabase.storage.from('avatars').upload(path, paymentQrFile, { upsert: true })
        if (uploadError) throw uploadError
        const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
        finalQrUrl = urlData.publicUrl
      }

      if (!finalQrUrl) {
        openAlert({ title: 'QR Required', message: 'Upload the QR code requesters will scan to pay you.', tone: 'warning', okLabel: 'Got It' })
        return
      }

      const { error } = await supabase
        .from('funeral_shops')
        .update({
          paymentQrUrl: finalQrUrl,
          serviceFeeAmount: parsedFee,
          updatedAt: new Date().toISOString(),
        })
        .eq('id', user.id)
      if (error) throw error

      setPaymentQrUrl(finalQrUrl)
      setPaymentFeeInput(String(parsedFee))
      setPaymentQrSavedAt(new Date().toISOString())
      clearPaymentQrSelection()
      setRequests(current => current.map(request =>
        request.status === 'accepted_by_shop'
          ? { ...request, status: 'awaiting_payment', paymentQrUrl: finalQrUrl, paymentAmount: parsedFee }
          : request
      ))

      openAlert({
        title: 'Payment Settings Saved',
        message: 'Every newly accepted request will use this QR code and amount automatically. Existing accepted requests are updated too.',
        tone: 'info',
        okLabel: 'Done',
      })
    } catch (err: any) {
      openAlert({ title: 'Save Failed', message: 'Failed to save payment settings: ' + (err?.message || 'Unknown error.'), tone: 'danger', okLabel: 'Dismiss' })
    } finally {
      setPaymentSaving(false)
    }
  }

  const handleRemovePaymentQr = () => {
    if (!paymentQrUrl || paymentSaving) return
    const parsedFee = Number(String(paymentFeeInput).replace(/[^\d.]/g, ''))
    openConfirm({
      title: 'Remove Payment QR?',
      message: 'Requesters will no longer be shown a QR code to pay you. The fee amount will be kept.',
      confirmLabel: 'Remove QR',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: async () => {
        if (!user) return
        setPaymentSaving(true)
        try {
          const { error } = await supabase
            .from('funeral_shops')
            .update({
              paymentQrUrl: null,
              serviceFeeAmount: Number.isFinite(parsedFee) && parsedFee > 0 ? parsedFee : null,
              updatedAt: new Date().toISOString(),
            })
            .eq('id', user.id)
          if (error) throw error
          setPaymentQrUrl(null)
          setPaymentQrSavedAt(new Date().toISOString())
          openAlert({ title: 'Payment QR Removed', message: 'The payment QR code was removed.', tone: 'info', okLabel: 'Done' })
        } catch (err: any) {
          openAlert({ title: 'Remove Failed', message: 'Failed to remove the QR code: ' + (err?.message || 'Unknown error.'), tone: 'danger', okLabel: 'Dismiss' })
        } finally {
          setPaymentSaving(false)
        }
      },
    })
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
    if (uploadedCount < 5) {
      openAlert({ title: 'Photos Required', message: "Please upload all 5 product photos so buyers can view all angles.", tone: 'warning', okLabel: 'Got It' })
      return
    }

    const finalVars = editorHasVariations ? editorVariationEntries : []
    if (editorHasVariations) {
      const hasInvalidVar = finalVars.some(v => !v.name.trim() || !v.imageUrl)
      if (hasInvalidVar) {
        openAlert({ title: 'Incomplete Variations', message: "Each variation needs a name and an image.", tone: 'warning', okLabel: 'Got It' })
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

  const handlePackageImageUpload = async (field: PackageField, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !user) return
    if (!file.type.startsWith('image/')) {
      openAlert({ title: 'Invalid File', message: 'Please choose an image file.', tone: 'warning', okLabel: 'Got It' })
      return
    }

    setUploadingPackageField(field)
    try {
      const ext = file.name.split('.').pop()
      const path = `packages/${user.id}_${field}_${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
      if (uploadError) throw uploadError
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
      const current = packages[0] || { shopId: user.id, active: true }
      setPackages([{ ...current, shopId: user.id, active: true, [field]: urlData.publicUrl }])
    } catch (err: any) {
      openAlert({ title: 'Upload Failed', message: err?.message || 'Unable to upload package picture.', tone: 'danger', okLabel: 'Dismiss' })
    } finally {
      setUploadingPackageField(null)
      event.target.value = ''
    }
  }

  const handleSavePackage = async () => {
    if (!user || packageSaving) return
    const current = packages[0]
    const missing = SHOP_PACKAGE_ITEMS.find(item => !current?.[item.field])
    if (missing) {
      openAlert({ title: 'Picture Required', message: `Add a picture for ${missing.label}.`, tone: 'warning', okLabel: 'Got It' })
      return
    }

    setPackageSaving(true)
    try {
      const payload: ShopPackage = {
        id: current.id,
        shopId: user.id,
        flowersImageUrl: current.flowersImageUrl || null,
        candlesImageUrl: current.candlesImageUrl || null,
        curtainsImageUrl: current.curtainsImageUrl || null,
        vehicleImageUrl: current.vehicleImageUrl || null,
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
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
      setAuthReady(true)
      if (!data.session?.user) setLoading(false)
    })
    const { data: l } = supabase.auth.onAuthStateChange((_, s) => {
      setUser(s?.user ?? null)
      setAuthReady(true)
      if (!s?.user) setLoading(false)
    })
    return () => l.subscription.unsubscribe()
  }, [])

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
    setLoading(true)
    setError(null)
    try {
      const { data: shopData, error: shopErr } = await supabase
        .from('funeral_shops')
        .select('*')
        .eq('id', user.id)
        .maybeSingle()
      if (shopErr) throw shopErr

      setShop(shopData ?? null)
      setPaymentQrUrl((shopData?.paymentQrUrl as string | null) || null)
      const storedFee = Number(shopData?.serviceFeeAmount) || 0
      setPaymentFeeInput(storedFee > 0 ? String(storedFee) : '')
      setPaymentQrSavedAt((shopData?.updatedAt as string | null) || null)

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
        .select('id, "shopId", "flowersImageUrl", "candlesImageUrl", "curtainsImageUrl", "vehicleImageUrl", active, "createdAt", "updatedAt"')
        .eq('shopId', user.id)
        .maybeSingle()
      if (packagesErr) throw packagesErr
      setPackages(packagesData ? [{
        id: String((packagesData as any).id),
        shopId: String((packagesData as any).shopId || user.id),
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

      const reqs: ServiceRequest[] = (reqData?.data ?? []) as ServiceRequest[]
      setRequests(reqs)

    } catch (e: any) {
      setError(e?.message ?? 'Unable to load shop data.')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { if (user) void loadData() }, [user, loadData])

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
          .select('id, name, "imageUrl"')
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

  const paidUntil = shop?.paidUntil ? new Date(shop.paidUntil) : null
  const subscriptionActive = Boolean(paymentVerified && paidUntil && paidUntil.getTime() > Date.now())
  const subscriptionExpired = Boolean(paymentVerified && paidUntil && paidUntil.getTime() <= Date.now())
  const daysLeft = daysRemaining(shop?.paidUntil)

  const openAdminPayments = () => {
    setSidebarExpanded(prev => ({ ...prev, finance: true }))
    setActiveTab('admin_payments')
  }

  const handleGoLive = () => {
    const currentShop = shop
    if (!currentShop || currentShop.status === 'live' || saving) return

    if (!paymentVerified) {
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
      title: 'Go Offline?',
      message: 'Your shop will be hidden from buyers the moment you confirm.',
      details: [
        'Your shop and products will no longer appear in buyer searches.',
        'Orders you already received will still be processed normally.',
        'Your subscription time keeps running — you can go live again anytime before it ends on ' + formatSubscriptionDate(shop.paidUntil) + '.',
      ],
      confirmLabel: 'Go Offline',
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
    const savedPaymentQr = String(paymentQrUrl || '').trim()
    const savedPaymentAmount = Number(paymentFeeInput) || 0

    if (accepting && (!savedPaymentQr || savedPaymentAmount <= 0)) {
      openAlert({
        title: 'Payment Setup Required',
        message: 'Save your shop payment QR code and default amount before accepting requests. They are applied automatically to every accepted request.',
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
            'The buyer will immediately see your saved QR code and default payment amount.',
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
            await acceptFuneralServiceRequest(request.id)
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
                  ? (shop?.shopName || 'The shop') + ' accepted your request. Please pay ' + formatPeso(savedPaymentAmount) + ' using the QR code now shown in your request.'
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
  const paymentSetupReady = Boolean(
    paymentQrUrl && Number(String(paymentFeeInput).replace(/[^\\d.]/g, '')) > 0
  )
  const readinessItems = [
    { label: 'Shop profile', detail: 'Address and contact details', complete: profileReady, tab: 'shop' },
    { label: 'Payment collection', detail: 'QR code and service fee', complete: paymentSetupReady, tab: 'payment_setup' },
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
        return ['payment_submitted', 'payment_verified'].includes(status) || Boolean(r.paymentProofImageUrl)
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

  const filtered = useMemo(() => {
    if (productTab === 'all') return products
    if (productTab === 'live') return products.filter(p => p.active && p.stock > 0)
    return products.filter(p => !p.active || p.stock <= 0)
  }, [products, productTab])

  const shopPackage = packages[0] || null

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

  if (!authReady || loading) {
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
        <div className="sc-access-denied">
          <div className="sc-access-denied-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0110 0v4"></path>
            </svg>
          </div>
          <h2 className="sc-access-denied-title">Access Denied</h2>
          <p className="sc-access-denied-desc">You need to be logged in as a funeral shop owner to access the Seller Centre.</p>
          <div className="sc-access-denied-actions">
            <button className="sc-access-denied-back" onClick={() => navigate(-1)}>Go Back</button>
            <Link to="/login" className="sc-access-denied-login">Login to Continue</Link>
          </div>
        </div>
      </div>
    )
  }

  if (!loading && !shop) {
    return (
      <div className="sc-page">
        <div className="sc-status-page">
          <h2>No Shop Registered</h2>
          <p>You haven't registered a funeral shop yet. Click below to register your shop and start selling on LifeCycle.</p>
          <div className="sc-status-page-actions">
            <button className="sc-btn sc-btn-secondary" onClick={() => navigate('/funeral')}>Go Back</button>
            <Link to="/seller/register" className="sc-primary-btn">Register Shop</Link>
          </div>
        </div>
      </div>
    )
  }

  if (!loading && shop?.status === 'pending') {
    return (
      <div className="sc-page">
        <div className="sc-status-page">
          <h2>Registration Pending</h2>
          <p>Your shop registration is currently under review. We will notify you once it has been verified.</p>
          <div className="sc-status-page-actions">
            <button className="sc-primary-btn" onClick={() => navigate('/funeral')}>Go Back</button>
          </div>
        </div>
      </div>
    )
  }

  if (!loading && shop?.status === 'rejected') {
    return (
      <div className="sc-page">
        <div className="sc-status-page">
          <h2>Registration Rejected</h2>
          <p>Your shop registration was not approved.</p>
          {shop.rejectionReason && (
            <div className="sc-status-page-error-box">
              <strong>Reason:</strong> {shop.rejectionReason}
            </div>
          )}
          <div className="sc-status-page-actions">
            <button className="sc-primary-btn" onClick={() => navigate('/funeral')}>Go Back</button>
          </div>
        </div>
      </div>
    )
  }

  if (!shop) return null

  return (
    <div className="sc-page">
      {/* ── Header Bar ── */}
      <div className="sc-header-bar">
        <div className="sc-header-left">
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
              className="sc-header-btn"
              title="Notifications"
              aria-haspopup="dialog"
              aria-expanded={notificationsOpen}
              aria-controls="sc-notification-menu"
              onClick={() => setNotificationsOpen(prev => !prev)}
            >
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" /></svg>
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
        <aside className="sc-sidebar">
          <nav className="sc-sidebar-nav">
            {/* Dashboard */}
            <div className={`sc-sidebar-item${activeTab === 'dashboard' ? ' active' : ''}`} onClick={() => setActiveTab('dashboard')}>
              <svg className="sc-sidebar-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
              Dashboard
            </div>

            {/* Operations Group */}
            <div className="sc-sidebar-group">
              <div className="sc-sidebar-group-header" onClick={() => setSidebarExpanded(prev => ({ ...prev, order: !prev.order }))}>
                <div className="sc-sidebar-group-title">
                  <svg className="sc-sidebar-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                  Operations
                </div>
                <svg className={`sc-arrow${sidebarExpanded.order ? ' expanded' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
              </div>
              {sidebarExpanded.order && (
                <div className="sc-sidebar-sub">
                  <div className={`sc-sidebar-sub-item${activeTab === 'orders' ? ' active' : ''}`} onClick={() => setActiveTab('orders')}>Arrangement Cases</div>
                  <div className={`sc-sidebar-sub-item${activeTab === 'customers' ? ' active' : ''}`} onClick={() => setActiveTab('customers')}>Customers</div>
                  <div className={`sc-sidebar-sub-item${activeTab === 'calendar' ? ' active' : ''}`} onClick={() => setActiveTab('calendar')}>Service Schedule</div>
                </div>
              )}
            </div>

            <div className={`sc-sidebar-item${activeTab === 'reports' ? ' active' : ''}`} onClick={() => setActiveTab('reports')}>
              <span className='sc-sidebar-icon' aria-hidden='true'>R</span>
              Reports
            </div>

            {/* Product Group */}
            <div className="sc-sidebar-group">
              <div className="sc-sidebar-group-header" onClick={() => setSidebarExpanded(prev => ({ ...prev, product: !prev.product }))}>
                <div className="sc-sidebar-group-title">
                  <svg className="sc-sidebar-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></svg>
                  Product
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
              <div className="sc-sidebar-group-header" onClick={() => setSidebarExpanded(prev => ({ ...prev, finance: !prev.finance }))}>
                <div className="sc-sidebar-group-title">
                  <svg className="sc-sidebar-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                  Finance
                </div>
                <svg className={`sc-arrow${sidebarExpanded.finance ? ' expanded' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
              </div>
              {sidebarExpanded.finance && (
                <div className="sc-sidebar-sub">
                  <div className={`sc-sidebar-sub-item${activeTab === 'payments' ? ' active' : ''}`} onClick={() => setActiveTab('payments')}>Family Payments</div>
                  <div className={`sc-sidebar-sub-item${activeTab === 'payment_setup' ? ' active' : ''}`} onClick={() => setActiveTab('payment_setup')}>Family Payment Setup</div>
                  <div className={`sc-sidebar-sub-item${activeTab === 'admin_payments' ? ' active' : ''}`} onClick={openAdminPayments}>LifeCycle Payments</div>
                </div>
              )}
            </div>

            {/* Setting Group */}
            <div className="sc-sidebar-group">
              <div className="sc-sidebar-group-header" onClick={() => setSidebarExpanded(prev => ({ ...prev, setting: !prev.setting }))}>
                <div className="sc-sidebar-group-title">
                  <svg className="sc-sidebar-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
                  Settings
                </div>
                <svg className={`sc-arrow${sidebarExpanded.setting ? ' expanded' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
              </div>
              {sidebarExpanded.setting && (
                <div className="sc-sidebar-sub">
                  <div className={`sc-sidebar-sub-item${activeTab === 'shop' ? ' active' : ''}`} onClick={() => setActiveTab('shop')}>Shop Profile</div>
                  <div className="sc-sidebar-sub-item" onClick={() => navigate('/funeral')}>Back to Marketplace</div>
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
                  <section className="sc-dashboard-intro">
                    <div className="sc-dashboard-intro-copy">
                      <span className="sc-dashboard-eyebrow">Shop overview</span>
                      <h1>{shop.shopName}</h1>
                      <p>Review cases that need attention, monitor performance, and keep your storefront ready for families.</p>
                    </div>
                    <div className="sc-dashboard-intro-actions">
                      {isShopOnline && (
                        <button type="button" className="sc-dashboard-btn sc-dashboard-btn-secondary" onClick={() => navigate(`/shop/${shop.id}`)}>
                          View storefront
                        </button>
                      )}
                      <button type="button" className="sc-dashboard-btn sc-dashboard-btn-primary" onClick={() => void openProductEditor(null)}>
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
                        Add product
                      </button>
                    </div>
                  </section>

                  <section className="sc-dashboard-kpis" aria-label="Shop performance summary">
                    <article className="sc-dashboard-kpi">
                      <span className="sc-dashboard-kpi-icon revenue" aria-hidden="true">₱</span>
                      <div><span>Confirmed value</span><strong>{formatPeso(report.revenue)}</strong><small>Verified and completed cases</small></div>
                    </article>
                    <article className="sc-dashboard-kpi">
                      <span className="sc-dashboard-kpi-icon cases" aria-hidden="true">
                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></svg>
                      </span>
                      <div><span>Active cases</span><strong>{stats.activeCases}</strong><small>{stats.awaitingFamilyConfirmation} awaiting family confirmation</small></div>
                    </article>
                    <article className="sc-dashboard-kpi">
                      <span className="sc-dashboard-kpi-icon requests" aria-hidden="true">
                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 2h9l5 5v15H6z" /><path d="M14 2v6h6M9 13h8M9 17h6" /></svg>
                      </span>
                      <div><span>New requests</span><strong>{stats.newRequests}</strong><small>{requests.length} total arrangement cases</small></div>
                    </article>
                    <article className="sc-dashboard-kpi">
                      <span className="sc-dashboard-kpi-icon products" aria-hidden="true">
                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m3 7 9-4 9 4-9 4-9-4Z" /><path d="m3 7 9 4 9-4M3 12l9 4 9-4" /></svg>
                      </span>
                      <div><span>Live products</span><strong>{stats.liveProducts}</strong><small>{stats.lowStockProducts + stats.soldOutProducts} need stock attention</small></div>
                    </article>
                  </section>

                  <section className="sc-dashboard-panel sc-dashboard-analytics">
                    <div className="sc-dashboard-panel-head">
                      <div>
                        <span className="sc-dashboard-panel-kicker">Performance</span>
                        <h2>Last six months</h2>
                      </div>
                      <button type="button" className="sc-dashboard-text-btn" onClick={() => setActiveTab('reports')}>Full report</button>
                    </div>
                    <div className="sc-dashboard-chart-grid">
                      <article className="sc-dashboard-chart-card">
                        <div className="sc-dashboard-chart-head">
                          <div><span>Cases received</span><strong>{report.monthly.reduce((total, entry) => total + entry.cases, 0)}</strong></div>
                          <small>Monthly requests</small>
                        </div>
                        <div className="sc-dashboard-chart-bars" role="img" aria-label="Cases received over the last six months">
                          {report.monthly.map((entry) => (
                            <div className="sc-dashboard-chart-column" key={entry.key}>
                              <span className="sc-dashboard-chart-value">{entry.cases}</span>
                              <div className="sc-dashboard-chart-track">
                                <span className="cases" style={{ height: `${entry.cases ? Math.max(8, Math.round((entry.cases / maxMonthlyCases) * 100)) : 3}%` }} />
                              </div>
                              <small>{entry.label}</small>
                            </div>
                          ))}
                        </div>
                      </article>

                      <article className="sc-dashboard-chart-card">
                        <div className="sc-dashboard-chart-head">
                          <div><span>Confirmed value</span><strong>{formatPeso(report.revenue)}</strong></div>
                          <small>Verified case value</small>
                        </div>
                        <div className="sc-dashboard-chart-bars" role="img" aria-label="Confirmed value over the last six months">
                          {report.monthly.map((entry) => (
                            <div className="sc-dashboard-chart-column" key={entry.key}>
                              <span className="sc-dashboard-chart-value">{formatCompactPeso(entry.revenue)}</span>
                              <div className="sc-dashboard-chart-track">
                                <span className="revenue" style={{ height: `${entry.revenue ? Math.max(8, Math.round((entry.revenue / maxMonthlyRevenue) * 100)) : 3}%` }} />
                              </div>
                              <small>{entry.label}</small>
                            </div>
                          ))}
                        </div>
                      </article>
                    </div>
                  </section>

                  <div className="sc-dashboard-primary-grid">
                    <section className="sc-dashboard-panel sc-dashboard-actions-panel">
                      <div className="sc-dashboard-panel-head">
                        <div><span className="sc-dashboard-panel-kicker">Action center</span><h2>Needs your attention</h2></div>
                        <span className="sc-dashboard-count">{attentionCount}</span>
                      </div>
                      <div className="sc-dashboard-action-list">
                        {stats.newRequests > 0 && (
                          <button type="button" className="sc-dashboard-action-item priority" onClick={() => setActiveTab('orders')}>
                            <span className="sc-dashboard-action-icon">!</span>
                            <span className="sc-dashboard-action-copy"><strong>Respond to new requests</strong><small>Accept or decline each family request promptly.</small></span>
                            <span className="sc-dashboard-action-value">{stats.newRequests}</span><span className="sc-dashboard-action-arrow" aria-hidden="true">›</span>
                          </button>
                        )}
                        {stats.paymentsToVerify > 0 && (
                          <button type="button" className="sc-dashboard-action-item warning" onClick={() => setActiveTab('payments')}>
                            <span className="sc-dashboard-action-icon">₱</span>
                            <span className="sc-dashboard-action-copy"><strong>Verify submitted payments</strong><small>Review references and uploaded payment proof.</small></span>
                            <span className="sc-dashboard-action-value">{stats.paymentsToVerify}</span><span className="sc-dashboard-action-arrow" aria-hidden="true">›</span>
                          </button>
                        )}
                        {stats.toProcessShipment > 0 && (
                          <button type="button" className="sc-dashboard-action-item info" onClick={() => setActiveTab('orders')}>
                            <span className="sc-dashboard-action-icon">✓</span>
                            <span className="sc-dashboard-action-copy"><strong>Prepare confirmed arrangements</strong><small>These cases have verified payments and can proceed.</small></span>
                            <span className="sc-dashboard-action-value">{stats.toProcessShipment}</span><span className="sc-dashboard-action-arrow" aria-hidden="true">›</span>
                          </button>
                        )}
                        {(stats.lowStockProducts + stats.soldOutProducts) > 0 && (
                          <button type="button" className="sc-dashboard-action-item neutral" onClick={() => setActiveTab('products')}>
                            <span className="sc-dashboard-action-icon">□</span>
                            <span className="sc-dashboard-action-copy"><strong>Review product availability</strong><small>Update low-stock or unavailable catalog items.</small></span>
                            <span className="sc-dashboard-action-value">{stats.lowStockProducts + stats.soldOutProducts}</span><span className="sc-dashboard-action-arrow" aria-hidden="true">›</span>
                          </button>
                        )}
                        {attentionCount === 0 && (
                          <div className="sc-dashboard-action-empty">
                            <span aria-hidden="true">✓</span>
                            <div><strong>Nothing urgent right now</strong><small>New requests and payment tasks will appear here.</small></div>
                          </div>
                        )}
                      </div>
                    </section>

                    <div className="sc-dashboard-side-stack">
                      <section className="sc-dashboard-panel sc-dashboard-readiness">
                        <div className="sc-dashboard-panel-head compact">
                          <div><span className="sc-dashboard-panel-kicker">Shop readiness</span><h2>{readinessProgress}% complete</h2></div>
                          <span className="sc-dashboard-readiness-score">{readinessCompleted}/{readinessItems.length}</span>
                        </div>
                        <div className="sc-dashboard-progress" aria-label={`Shop readiness ${readinessProgress}%`}><span style={{ width: `${readinessProgress}%` }} /></div>
                        <div className="sc-dashboard-checklist">
                          {readinessItems.map((item) => (
                            <button type="button" key={item.label} onClick={() => setActiveTab(item.tab)}>
                              <span className={item.complete ? 'complete' : ''}>{item.complete ? '✓' : '○'}</span>
                              <span><strong>{item.label}</strong><small>{item.detail}</small></span>
                              <b aria-hidden="true">›</b>
                            </button>
                          ))}
                        </div>
                      </section>

                      <section className="sc-dashboard-panel sc-dashboard-quick">
                        <div className="sc-dashboard-panel-head compact"><div><span className="sc-dashboard-panel-kicker">Shortcuts</span><h2>Quick actions</h2></div></div>
                        <div className="sc-dashboard-quick-grid">
                          <button type="button" onClick={() => void openProductEditor(null)}><span>+</span><strong>Add product</strong></button>
                          <button type="button" onClick={() => setActiveTab('orders')}><span>↗</span><strong>View cases</strong></button>
                          <button type="button" onClick={() => setActiveTab('payment_setup')}><span>₱</span><strong>Payment setup</strong></button>
                          <button type="button" onClick={() => setActiveTab('shop')}><span>⌂</span><strong>Edit profile</strong></button>
                        </div>
                      </section>
                    </div>
                  </div>

                  <div className="sc-dashboard-secondary-grid">
                    <section className="sc-dashboard-panel">
                      <div className="sc-dashboard-panel-head">
                        <div><span className="sc-dashboard-panel-kicker">Latest activity</span><h2>Recent arrangement cases</h2></div>
                        <button type="button" className="sc-dashboard-text-btn" onClick={() => setActiveTab('orders')}>View all</button>
                      </div>
                      {recentRequests.length === 0 ? (
                        <div className="sc-dashboard-list-empty">Arrangement requests will appear here.</div>
                      ) : (
                        <div className="sc-dashboard-case-list">
                          {recentRequests.map((request) => (
                            <button type="button" key={request.id} onClick={() => openRequestDetail(request)}>
                              <span className="sc-dashboard-case-avatar">{(request.requesterName || request.familyCoordinatorName || request.productName || 'C').trim().charAt(0).toUpperCase()}</span>
                              <span className="sc-dashboard-case-copy">
                                <strong>{request.requesterName || request.familyCoordinatorName || 'Family request'}</strong>
                                <small>{request.productName || 'Custom arrangement'} · {formatTimestamp(request.createdAt)}</small>
                              </span>
                              <span className={`sc-status sc-status-${String(request.status || 'pending').toLowerCase()}`}>{String(request.status || 'pending').replace(/_/g, ' ')}</span>
                              <span className="sc-dashboard-action-arrow" aria-hidden="true">›</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </section>

                    <section className="sc-dashboard-panel">
                      <div className="sc-dashboard-panel-head">
                        <div><span className="sc-dashboard-panel-kicker">Schedule</span><h2>Upcoming services</h2></div>
                        <button type="button" className="sc-dashboard-text-btn" onClick={() => setActiveTab('calendar')}>Open calendar</button>
                      </div>
                      {upcomingRequests.length === 0 ? (
                        <div className="sc-dashboard-list-empty">No upcoming services have been scheduled.</div>
                      ) : (
                        <div className="sc-dashboard-schedule-list">
                          {upcomingRequests.map((request) => (
                            <button type="button" key={request.id} onClick={() => openRequestDetail(request)}>
                              <span className="sc-dashboard-date">
                                <strong>{request.wakeStartDate ? new Date(request.wakeStartDate).getDate() : '--'}</strong>
                                <small>{request.wakeStartDate ? new Date(request.wakeStartDate).toLocaleDateString('en-PH', { month: 'short' }) : 'TBD'}</small>
                              </span>
                              <span className="sc-dashboard-case-copy">
                                <strong>{request.deceasedFullName || request.productName || 'Arrangement service'}</strong>
                                <small>{request.wakeAddress || 'Venue not set'}</small>
                              </span>
                              <span className="sc-dashboard-schedule-meta">{formatScheduleDate(request.wakeStartDate)}</span>
                              <span className="sc-dashboard-action-arrow" aria-hidden="true">›</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                </div>
              )}

              {/* CUSTOMERS VIEW */}
              {activeTab === 'customers' && (
                <div className='sc-ops-page'>
                  <div className='sc-section-head'>
                    <div>
                      <h2>Customers</h2>
                      <p className='sc-card-subtitle'>Family contacts and their complete arrangement history.</p>
                    </div>
                    <span className='sc-count-label'>{customers.length} customers</span>
                  </div>
                  <input className='sc-simple-search' value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder='Search by name or contact number' aria-label='Search customers' />
                  {visibleCustomers.length === 0 ? (
                    <div className='sc-empty'><p>{customers.length ? 'No customers match your search.' : 'Customer profiles will appear after families send requests.'}</p></div>
                  ) : (
                    <div className='sc-simple-list'>
                      {visibleCustomers.map((customer) => (
                        <button key={customer.id} type='button' className='sc-customer-row' onClick={() => setSelectedCustomerId(customer.id)}>
                          <span className='sc-customer-avatar'>{customer.name.trim().charAt(0).toUpperCase() || 'C'}</span>
                          <span className='sc-customer-main'>
                            <strong>{customer.name}</strong>
                            <small>{customer.contactNumber || 'No contact number'} - Last activity {formatTimestamp(customer.lastActivity)}</small>
                          </span>
                          <span className='sc-customer-metric'><strong>{customer.arrangements.length}</strong><small>Cases</small></span>
                          <span className='sc-customer-metric'><strong>{customer.activeCount}</strong><small>Active</small></span>
                          <span className='sc-customer-metric sc-customer-value'><strong>{formatPeso(customer.totalValue)}</strong><small>Confirmed value</small></span>
                          <span className='sc-row-arrow' aria-hidden='true'>&gt;</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* CALENDAR VIEW */}
              {activeTab === 'calendar' && (
                <div className='sc-ops-page'>
                  <div className='sc-section-head'>
                    <div>
                      <h2>Service Calendar</h2>
                      <p className='sc-card-subtitle'>Wake and burial schedules from active arrangement cases.</p>
                    </div>
                    <button className='sc-btn' onClick={() => void loadData()} disabled={loading}>Refresh</button>
                  </div>
                  <div className='sc-summary-strip'>
                    <div><strong>{scheduledRequests.length}</strong><span>Scheduled cases</span></div>
                    <div><strong>{requests.filter((request) => !request.wakeStartDate && !request.wakeEndDate && !request.burialTime).length}</strong><span>Need a schedule</span></div>
                  </div>
                  {scheduledRequests.length === 0 ? (
                    <div className='sc-empty'><p>No services have been scheduled yet.</p></div>
                  ) : (
                    <div className='sc-schedule-list'>
                      {scheduledRequests.map((request) => (
                        <button key={request.id} type='button' className='sc-schedule-row' onClick={() => openRequestDetail(request)}>
                          <span className='sc-date-tile'>
                            <strong>{request.wakeStartDate ? new Date(request.wakeStartDate).getDate() : '--'}</strong>
                            <small>{request.wakeStartDate ? new Date(request.wakeStartDate).toLocaleDateString('en-PH', { month: 'short' }) : 'TBD'}</small>
                          </span>
                          <span className='sc-schedule-main'>
                            <strong>{request.deceasedFullName || request.productName || 'Arrangement case'}</strong>
                            <small>{request.familyCoordinatorName || request.requesterName || 'Requestor'} - {request.wakeAddress || 'Venue not set'}</small>
                          </span>
                          <span className='sc-schedule-time'>{formatScheduleDate(request.wakeStartDate)} to {formatScheduleDate(request.wakeEndDate)}</span>
                          <span className={`sc-status sc-status-${String(request.status || '').toLowerCase()}`}>{String(request.status || 'pending').replace(/_/g, ' ')}</span>
                        </button>
                      ))}
                    </div>
                  )}
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
                      <p className="sc-card-subtitle">One shop package appears automatically on every product.</p>
                    </div>
                    <button className="sc-primary-btn" disabled={packageSaving || Boolean(uploadingPackageField)} onClick={() => void handleSavePackage()}>
                      {packageSaving ? 'Saving...' : 'Save Package'}
                    </button>
                  </div>

                  <div className="sc-package-grid">
                    {SHOP_PACKAGE_ITEMS.map(item => {
                      const imageUrl = shopPackage?.[item.field] || null
                      const uploading = uploadingPackageField === item.field
                      return (
                        <section className="sc-package-tile" key={item.key}>
                          <div className="sc-package-tile-head">
                            <h3>{item.label}</h3>
                            {imageUrl ? <span>Ready</span> : <span className="is-missing">Needs picture</span>}
                          </div>
                          <div className="sc-package-image-box">
                            {imageUrl ? <img src={imageUrl} alt={item.label} /> : uploading ? <div className="sc-spinner" /> : <span>No picture added</span>}
                          </div>
                          <label className="sc-btn sc-btn-secondary sc-package-upload">
                            {imageUrl ? 'Replace Picture' : 'Upload Picture'}
                            <input
                              type="file"
                              accept="image/*"
                              style={{ display: 'none' }}
                              disabled={uploadingPackageField !== null || packageSaving}
                              onChange={(event) => void handlePackageImageUpload(item.field, event)}
                            />
                          </label>
                        </section>
                      )
                    })}
                  </div>
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
                    <span className='sc-count-label'>{requests.length} cases</span>
                  </div>
                  {requests.length === 0 ? (
                    <div className="sc-empty"><p>No service requests yet.</p></div>
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
                          {requests.map(r => (
                            <tr key={r.id}>
                              <td>
                                <div className="sc-product-cell">
                                  {r.productImageUrl ? (
                                    <img src={r.productImageUrl} alt={r.productName} className="sc-product-thumb" />
                                  ) : (
                                    <div className="sc-product-thumb-sc">LC</div>
                                  )}
                                  <div>
                                    <div style={{ fontWeight: 600 }}>{r.productName || 'Custom Casket'}</div>
                                    {r.variationName && <div style={{ fontSize: '11px', color: 'var(--sc-muted)' }}>Variation: {r.variationName}</div>}
                                    <div style={{ fontSize: '12px', color: 'var(--sc-brand)', marginTop: '4px' }}>{formatPeso(r.productPrice)}</div>
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
                                    <span style={{ fontSize: '12px', color: 'var(--sc-muted)' }}>Complete shop payment settings</span>
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
                <div className="sc-finance-layout">
                  <header className="sc-finance-header">
                    <div>
                      <span className="sc-finance-kicker">Finance</span>
                      <h2>Family payments</h2>
                      <p>Review payment receipts submitted for arrangement cases.</p>
                    </div>
                    <button className="sc-finance-refresh" onClick={() => void loadData()} disabled={loading}>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 5v6h-6" /></svg>
                      Refresh
                    </button>
                  </header>

                  <section className="sc-finance-summary" aria-label="Family payment summary">
                    <article className="sc-finance-summary-primary">
                      <span>Confirmed payments</span>
                      <strong>{formatPeso(financeSummary.received)}</strong>
                      <small>{financeSummary.verified} verified receipt{financeSummary.verified === 1 ? '' : 's'}</small>
                    </article>
                    <article>
                      <span>Needs review</span>
                      <strong>{financeSummary.awaitingReview}</strong>
                      <small>Receipt{financeSummary.awaitingReview === 1 ? '' : 's'} awaiting a decision</small>
                    </article>
                    <article>
                      <span>All submissions</span>
                      <strong>{paymentSubmissions.length}</strong>
                      <small>Payment records received</small>
                    </article>
                  </section>

                  <section className="sc-finance-panel">
                    <div className="sc-finance-panel-head">
                      <div>
                        <h3>Payment receipts</h3>
                        <p>Open a request to review its complete payment information and receipt.</p>
                      </div>
                      <span>{paymentSubmissions.length} total</span>
                    </div>

                  {paymentSubmissions.length === 0 ? (
                    <div className="sc-finance-empty">
                      <div aria-hidden="true">
                        <svg viewBox="0 0 24 24"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 8h6M9 12h6" /></svg>
                      </div>
                      <strong>No payment receipts yet</strong>
                      <span>Submitted family payments will appear here for review.</span>
                    </div>
                  ) : (
                    <div className="sc-table-wrap sc-finance-table-wrap">
                      <table className="sc-table sc-finance-table">
                        <thead>
                          <tr>
                            <th>Service</th>
                            <th>Sender</th>
                            <th>Amount</th>
                            <th>Status</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paymentSubmissions.map(r => {
                            const status = String(r.status || '').toLowerCase()
                            const submitted = status === 'payment_submitted'
                            const verified = ['payment_verified', 'awaiting_customer_confirmation', 'completed'].includes(status)
                            const rejected = status === 'awaiting_payment' && Boolean(r.paymentRejectionReason)

                            return (
                              <tr key={r.id}>
                                <td>
                                  <div className="sc-product-cell">
                                    {r.productImageUrl ? (
                                      <img src={r.productImageUrl} alt={r.productName} className="sc-product-thumb" />
                                    ) : (
                                      <div className="sc-product-thumb-sc">LC</div>
                                    )}
                                    <div>
                                      <div style={{ fontWeight: 600 }}>{r.productName || 'Custom Casket'}</div>
                                      {r.variationName && <div style={{ fontSize: '11px', color: 'var(--sc-muted)' }}>Variation: {r.variationName}</div>}
                                    </div>
                                  </div>
                                </td>
                                <td className="sc-finance-sender">
                                  <div style={{ fontWeight: 600 }}>{r.paymentPayerName || '—'}</div>
                                  {r.paymentSubmittedAt && (
                                    <small>{formatTimestamp(r.paymentSubmittedAt)}</small>
                                  )}
                                </td>
                                <td className="sc-finance-amount">{r.paymentAmount != null && Number(r.paymentAmount) > 0 ? formatPeso(r.paymentAmount) : '—'}</td>
                                <td>
                                  <span className={`sc-finance-status ${submitted ? 'is-pending' : verified ? 'is-verified' : 'is-rejected'}`}>
                                    {submitted ? 'Awaiting Verification' : verified ? 'Verified' : rejected ? 'Rejected' : (r.status || '').replace(/_/g, ' ')}
                                  </span>
                                  {rejected && r.paymentRejectionReason && (
                                    <div className="sc-finance-rejection" title={r.paymentRejectionReason}>
                                      {r.paymentRejectionReason.length > 60 ? r.paymentRejectionReason.slice(0, 60) + '…' : r.paymentRejectionReason}
                                    </div>
                                  )}
                                </td>
                                <td>
                                  <div className="sc-finance-actions">
                                    <button
                                      type="button"
                                      className="sc-finance-action"
                                      disabled={saving}
                                      onClick={() => openRequestDetail(r)}
                                    >
                                      Review
                                    </button>
                                    {submitted ? (
                                      <>
                                        <button
                                          className="sc-finance-action sc-finance-action-verify"
                                          disabled={saving || paymentVerifyingId === r.id}
                                          onClick={() => void handleVerifyPayment(r, 'verified')}
                                        >
                                          {paymentVerifyingId === r.id ? 'Updating…' : 'Verify'}
                                        </button>
                                        <button
                                          className="sc-finance-action sc-finance-action-reject"
                                          disabled={saving || paymentVerifyingId === r.id}
                                          onClick={() => void handleVerifyPayment(r, 'rejected')}
                                        >
                                          Reject
                                        </button>
                                      </>
                                    ) : verified ? (
                                      <span className="sc-finance-reviewed">
                                        {r.paymentVerifiedAt ? `Verified ${new Date(r.paymentVerifiedAt).toLocaleDateString()}` : 'Verified'}
                                      </span>
                                    ) : (
                                      <span className="sc-finance-reviewed">—</span>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  </section>
                </div>
              )}

              {/* SHOP VIEW */}
              {activeTab === 'shop' && (
                <div className="sc-shop-layout">
                  <h2>Shop Profile</h2>

                  {shop.status === 'verified' || shop.status === 'live' || shop.status === 'offline' ? (
                    <div className={`sc-shop-status-card${subscriptionExpired ? ' sc-shop-status-card-expired' : ''}${subscriptionActive && daysLeft <= 7 ? ' sc-shop-status-card-expiring' : ''}`}>
                      <div className="sc-shop-status-info">
                        <div className="sc-shop-status-head">
                          <h3>Shop Status</h3>
                          </div>
                        <p className="sc-shop-status-desc">
                          {subscriptionExpired
                            ? `Your subscription expired on ${formatSubscriptionDate(shop.paidUntil)}. Your shop is offline and hidden from buyers. Renew to get 1 more month of live access.`
                            : shop.status === 'live'
                              ? `Your shop is live and buyers can see and order from it. Your subscription ends on ${formatSubscriptionDate(shop.paidUntil)} (${daysLeft} day${daysLeft === 1 ? '' : 's'} left).`
                              : shop.status === 'offline'
                                ? shop.paidUntil
                                  ? `Your shop is currently offline and hidden from buyers. Your subscription runs until ${formatSubscriptionDate(shop.paidUntil)} (${daysLeft} day${daysLeft === 1 ? '' : 's'} left). Click Go Live to bring it back online.`
                                  : 'Your shop is currently offline and hidden from buyers. Click Go Live to bring it back online.'
                                : paymentVerified
                                  ? shop.paidUntil
                                    ? `Your payment is verified. Your subscription runs until ${formatSubscriptionDate(shop.paidUntil)} (${daysLeft} day${daysLeft === 1 ? '' : 's'} left). Click Go Live to activate your shop.`
                                    : 'Your payment is verified. Click Go Live to activate your shop.'
                                  : payment?.status === 'pending'
                                    ? 'Your payment is under review. Once it is verified by an admin, you can go live.'
                                    : 'Pay your registration fee to activate your shop. Click Go Live to see the payment details.'}
                        </p>
                        {subscriptionActive ? (
                          <div className="sc-shop-sub-info">
                            {daysLeft <= 7 ? (
                              <span className="sc-shop-sub-badge sc-shop-sub-badge-warn">
                                Expiring soon · {daysLeft} day{daysLeft === 1 ? '' : 's'} left
                              </span>
                            ) : (
                              <span className="sc-shop-sub-badge">
                                Subscription active until {formatSubscriptionDate(shop.paidUntil)}
                              </span>
                            )}
                          </div>
                        ) : subscriptionExpired ? (
                          <div className="sc-shop-sub-info">
                            <span className="sc-shop-sub-badge sc-shop-sub-badge-danger">
                              Subscription expired on {formatSubscriptionDate(shop.paidUntil)}
                            </span>
                          </div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="sc-shop-status-btn"
                        onClick={subscriptionExpired ? openAdminPayments : shop.status === 'live' ? handleGoOffline : handleGoLive}
                        disabled={saving}
                      >
                        {subscriptionExpired
                          ? 'Renew Subscription'
                          : shop.status === 'live'
                            ? 'Go Offline'
                            : 'Go Live'}
                      </button>
                    </div>
                  ) : null}

                  <div className="sc-card">
                    <div className="sc-shop-cover">
                      {shop.coverImageUrl ? (
                        <img src={shop.coverImageUrl} alt={`${shop.shopName} cover`} />
                      ) : (
                        <span className="sc-shop-cover-ph">Add a cover photo</span>
                      )}
                      {uploadingShopCover && (
                        <div className="sc-shop-cover-spinner"><div className="sc-spinner" /></div>
                      )}
                      <label className="sc-shop-cover-upload">
                        {uploadingShopCover ? 'Uploading…' : 'Upload Cover'}
                        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleUploadShopImage(e, 'coverImageUrl')} />
                      </label>
                    </div>
                    <div className="sc-shop-header">
                      <div className="sc-shop-icon-wrap">
                        <div className="sc-shop-icon">
                          {shop.shopImageUrl ? (
                            <img src={shop.shopImageUrl} alt={shop.shopName} />
                          ) : (
                            <span className="sc-shop-icon-ph">LC</span>
                          )}
                        </div>
                        <label className="sc-shop-profile-upload">
                          {uploadingShopProfile ? 'Uploading…' : 'Upload Profile'}
                          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleUploadShopImage(e, 'shopImageUrl')} />
                        </label>
                      </div>
                      <div>
                        <h3>{shop.shopName}</h3>
                        {shop.rejectionReason && (
                          <p className="sc-rejection">Reason: {shop.rejectionReason}</p>
                        )}
                      </div>
                    </div>
                    <div className="sc-detail-grid">
                      <div className="sc-detail"><span>Address</span><strong>{shop.shopAddress || '—'}</strong></div>
                      <div className="sc-detail"><span>Phone</span><strong>{shop.shopPhoneNumber || '—'}</strong></div>
                      <div className="sc-detail"><span>Location</span><strong>{shop.generalLocation || '—'}</strong></div>
                      <div className="sc-detail"><span>Member since</span><strong>{new Date(shop.createdAt).toLocaleDateString()}</strong></div>
                    </div>
                  </div>
                </div>
              )}

              {/* PAYMENTS TO ADMIN VIEW */}
              {activeTab === 'admin_payments' && (
                <div className="sc-payment-layout sc-admin-payments-layout">
                  <XenditShopPaymentCard
                    className="sc-lifecycle-payment-card"
                    title="LifeCycle billing"
                    description="Submit your shop registration or renewal payment and review its approval status."
                    onSuccess={() => void loadData()}
                  />
                </div>
              )}

              {/* PAYMENT QR & AMOUNT VIEW */}
              {activeTab === 'payment_setup' && (
                <div className="sc-finance-layout sc-finance-setup-layout">
                  <header className="sc-finance-header">
                    <div>
                      <span className="sc-finance-kicker">Finance</span>
                      <h2>Family payment setup</h2>
                      <p>Set the QR code and default amount shown after accepting a request.</p>
                    </div>
                    <span className={`sc-finance-setup-status ${paymentSetupReady ? 'is-ready' : 'is-required'}`}>
                      <i aria-hidden="true" />
                      {paymentSetupReady ? 'Ready to collect' : 'Setup required'}
                    </span>
                  </header>

                  <section className="sc-finance-setup-panel">
                    <div className="sc-finance-qr-pane">
                      <div className="sc-finance-field-heading">
                        <span>Payment QR</span>
                        {paymentQrUrl && (
                          <small>{paymentQrSavedAt ? `Updated ${new Date(paymentQrSavedAt).toLocaleDateString()}` : 'Saved'}</small>
                        )}
                      </div>
                      <div className="sc-payment-qr-box">
                        {paymentQrPreview ? (
                          <img className="sc-payment-qr-img" src={paymentQrPreview} alt="New payment QR preview" />
                        ) : paymentQrUrl ? (
                          <img className="sc-payment-qr-img" src={paymentQrUrl} alt="Payment QR" />
                        ) : (
                          <div className="sc-payment-qr-empty">No QR code uploaded yet.</div>
                        )}
                      </div>
                      <small className="sc-finance-qr-note">Use a clear GCash or e-wallet QR image.</small>
                    </div>

                    <div className="sc-finance-setup-fields">
                      <span className="sc-finance-kicker">Collection details</span>
                      <h3>Default family payment</h3>
                      <p>This amount and QR code are shared with the family when you accept an arrangement request.</p>

                      <label className="sc-finance-amount-field">
                        <span>Amount to collect</span>
                        <div>
                          <b>₱</b>
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={paymentFeeInput}
                            onChange={e => setPaymentFeeInput(e.target.value)}
                          />
                        </div>
                      </label>

                      <div className="sc-payment-qr-actions">
                        <input
                          ref={paymentQrFileInputRef}
                          type="file"
                          accept="image/*"
                          style={{ display: 'none' }}
                          onChange={handlePaymentQrFileChange}
                        />
                        <button
                          className="sc-finance-action"
                          disabled={paymentSaving}
                          onClick={() => paymentQrFileInputRef.current?.click()}
                        >
                          {paymentQrPreview || paymentQrUrl ? 'Replace QR Code' : 'Upload QR Code'}
                        </button>
                        {paymentQrPreview && (
                          <button className="sc-finance-action" disabled={paymentSaving} onClick={clearPaymentQrSelection}>
                            Cancel
                          </button>
                        )}
                        {paymentQrUrl && !paymentQrPreview && (
                          <button className="sc-finance-action sc-finance-action-reject" disabled={paymentSaving} onClick={handleRemovePaymentQr}>
                            Remove QR
                          </button>
                        )}
                      </div>
                    </div>

                    <footer className="sc-finance-setup-footer">
                      <span>Changes apply to newly accepted requests.</span>
                      <button className="sc-btn sc-btn-primary" disabled={paymentSaving} onClick={handleSavePaymentSettings}>
                        {paymentSaving ? 'Saving…' : 'Save Payment Settings'}
                      </button>
                    </footer>
                  </section>
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
                          <span className="sc-editor-section-desc">Please upload exactly 5 high-resolution photos displaying your product from different angles.</span>
                        </label>
                        <div className="sc-image-slots-grid">
                          {editorImages.map((img, idx) => (
                            <div key={idx} className="sc-image-slot">
                              {img ? (
                                <div className="sc-image-preview-container">
                                  <img src={img} alt={`Product Angle ${idx + 1}`} className="sc-image-preview" />
                                  <button type="button" className="sc-image-remove-btn" onClick={() => setEditorImages(prev => prev.map((item, i) => i === idx ? null : item))}>
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
                                      <span>Add photo {idx + 1}</span>
                                    </>
                                  )}
                                  <input type="file" accept="image/jpeg,image/png" style={{ display: 'none' }} disabled={editorUploadingIndex !== null} onChange={(e) => void handleUploadImage(idx, e)} />
                                </label>
                              )}
                            </div>
                          ))}
                        </div>
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
                                setEditorVariationEntries([{ name: "", imageUrl: null }])
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
                                  </div>
                                </div>
                              ))}
                            </div>
                            <div style={{ marginTop: '16px' }}>
                              <button type="button" className="sc-btn" onClick={() => setEditorVariationEntries(prev => [...prev, { name: "", imageUrl: null }])}>
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
                          <span className="sc-editor-section-desc">Your saved shop package appears automatically after buyers choose a variation.</span>
                        </label>
                        {shopPackage ? (
                          <div className="sc-editor-package-preview">
                            {SHOP_PACKAGE_ITEMS.map(item => {
                              const imageUrl = shopPackage[item.field] || null
                              return (
                                <div className="sc-editor-package-item" key={item.key}>
                                  {imageUrl ? <img src={imageUrl} alt={item.label} /> : <div className="sc-editor-package-empty">No image</div>}
                                  <span>{item.label}</span>
                                </div>
                              )
                            })}
                          </div>
                        ) : (
                          <div className="sc-editor-package-note">
                            Add package pictures in the Packages tab to show Flowers, Candles, Curtains, and Vehicle on every product.
                          </div>
                        )}
                      </div>

                      {/* Description */}
                      <div className="sc-editor-section">
                        <div className="sc-form-group">
                          <label htmlFor="prodDesc">Product Description</label>
                          <textarea id="prodDesc" className="sc-form-input sc-form-textarea" placeholder="Describe the materials, craftsmanship, dimensions, and other services included..." value={editorDescription} onChange={(e) => setEditorDescription(e.target.value)} />
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
        <div className='sc-modal-overlay' onClick={() => setSelectedCustomerId(null)}>
          <div className='sc-modal' onClick={(event) => event.stopPropagation()}>
            <div className='sc-modal-header'>
              <h3>Customer History</h3>
              <button type='button' className='sc-modal-close' aria-label='Close' onClick={() => setSelectedCustomerId(null)}>x</button>
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
              <div className='sc-detail-section'>
                <h5>Arrangement history</h5>
                <div className='sc-simple-list'>
                  {selectedCustomer.arrangements.map((request) => (
                    <button key={request.id} type='button' className='sc-history-row' onClick={() => { setSelectedCustomerId(null); openRequestDetail(request) }}>
                      <span>
                        <strong>{request.deceasedFullName || request.productName || 'Arrangement case'}</strong>
                        <small>{request.productName || 'Custom service'} - {formatTimestamp(request.createdAt)}</small>
                      </span>
                      <span className={`sc-status sc-status-${String(request.status || '').toLowerCase()}`}>{String(request.status || 'pending').replace(/_/g, ' ')}</span>
                    </button>
                  ))}
                </div>
              </div>
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
                        <span>{v.name}</span>
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
        const statusLabel = String(r.status || 'pending').replace(/_/g, ' ').replace(/\\b\\w/g, letter => letter.toUpperCase())
        const requestTypeLabel = r.requestType?.replace(/_/g, ' ').replace(/\\b\\w/g, letter => letter.toUpperCase()) || 'Standard service'
        const showPayment = ['awaiting_payment', 'payment_submitted', 'payment_verified', 'awaiting_customer_confirmation', 'completed'].includes(status) && (
          r.paymentAmount != null || r.paymentPayerName || r.paymentGcashName || r.paymentGcashNumber || r.paymentReferenceNumber || r.paymentProofImageUrl || r.paymentSubmittedAt
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
                    <div className="sc-product-detail-price">{formatPeso(r.productPrice)}</div>
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
                      <div className="sc-pd-row"><span>Sender Name</span><strong>{r.paymentPayerName || '—'}</strong></div>
                      <div className="sc-pd-row"><span>GCash Name</span><strong>{r.paymentGcashName || '—'}</strong></div>
                      <div className="sc-pd-row"><span>GCash Number</span><strong>{r.paymentGcashNumber || '—'}</strong></div>
                      <div className="sc-pd-row"><span>Reference Number</span><strong>{r.paymentReferenceNumber || '—'}</strong></div>
                      <div className="sc-pd-row"><span>Submitted At</span><strong>{formatTimestamp(r.paymentSubmittedAt)}</strong></div>
                      {r.paymentVerifiedAt && <div className="sc-pd-row"><span>Verified At</span><strong>{formatTimestamp(r.paymentVerifiedAt)}</strong></div>}
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
