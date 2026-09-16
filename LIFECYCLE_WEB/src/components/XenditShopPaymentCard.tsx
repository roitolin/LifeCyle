import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import { createXenditShopCheckout, syncXenditShopPayment, type XenditShopPaymentMethod } from '@/utils/xenditShop'
import { getPaymentQrSetting } from '@/utils/paymentQrSettings'
import './XenditShopPaymentCard.css'

type Props = {
  title?: string
  description?: string
  className?: string
  onSuccess?: () => void
}

type Payment = {
  id: string
  status: 'pending' | 'verified' | 'rejected'
  amount: number
  referenceNumber: string
  createdAt: string
  verifiedAt: string | null
  expiresAt: string | null
  rejectionReason: string | null
  payerName: string | null
  paymentProvider: 'manual' | 'paymongo' | 'xendit'
  providerCheckoutUrl: string | null
  providerPaymentId: string | null
  providerPaymentMethod: string | null
}

const PAYMENT_METHODS: Array<{ id: XenditShopPaymentMethod; label: string; detail: string; icon: string }> = [
  { id: 'gcash', label: 'GCash', detail: 'Verified shop phone and password required', icon: 'G' },
  { id: 'ewallets', label: 'Other e-wallets', detail: 'GrabPay and ShopeePay test channels', icon: 'W' },
  { id: 'cards', label: 'Cards', detail: 'Xendit sandbox test cards', icon: 'C' },
  { id: 'qrph', label: 'QR Ph', detail: 'Xendit Test Mode QR payment', icon: 'QR' },
  { id: 'bank_transfer', label: 'Bank transfer', detail: 'Xendit Test Mode bank transfer', icon: 'B' },
]

function normalizePhilippinePhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (/^09\d{9}$/.test(digits)) return `+63${digits.slice(1)}`
  if (/^639\d{9}$/.test(digits)) return `+${digits}`
  if (/^9\d{9}$/.test(digits)) return `+63${digits}`
  return null
}

function maskPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits.length >= 4 ? `+63 9•• ••• ${digits.slice(-4)}` : 'Verified number'
}

const peso = (value: number) => new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
}).format(value || 0)

const dateTime = (value?: string | null) => value
  ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
  : '-'

function statusText(payment: Payment) {
  if (payment.status === 'verified') return 'Paid'
  if (payment.status === 'rejected') return 'Not completed'
  if (payment.paymentProvider === 'xendit') return 'Awaiting checkout'
  if (payment.paymentProvider === 'paymongo') return 'Legacy checkout'
  return 'Admin review'
}

function receiptNumber(payment: Payment) {
  return `LC-${payment.id.replace(/-/g, '').slice(0, 12).toUpperCase()}`
}

function receiptMessage(payment: Payment) {
  if (payment.status === 'verified') return 'LifeCycle confirmed this registration payment automatically through Xendit.'
  if (payment.status === 'rejected') return 'This registration payment was not completed. Review the reason below before trying again.'
  return 'Your checkout is waiting for completion or confirmation from Xendit.'
}

export default function XenditShopPaymentCard({
  title = 'Pay Your Registration Fee',
  description = 'Use Xendit secure Test Mode checkout. Payment confirmation is automatic.',
  className,
  onSuccess,
}: Props) {
  const { openAlert, alertDialog } = useAlertDialog()
  const [ready, setReady] = useState(false)
  const [starting, setStarting] = useState(false)
  const [fee, setFee] = useState(0)
  const [payments, setPayments] = useState<Payment[]>([])
  const [shopName, setShopName] = useState('Funeral shop')
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null)
  const [purchaseConfirmOpen, setPurchaseConfirmOpen] = useState(false)
  const [paymentMethodMenuOpen, setPaymentMethodMenuOpen] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<XenditShopPaymentMethod>('gcash')
  const [accountPassword, setAccountPassword] = useState('')
  const [passwordConfirmed, setPasswordConfirmed] = useState(false)
  const [checkingPassword, setCheckingPassword] = useState(false)
  const [phoneInput, setPhoneInput] = useState('')
  const [pendingPhone, setPendingPhone] = useState('')
  const [verifiedPhone, setVerifiedPhone] = useState('')
  const [phoneOtp, setPhoneOtp] = useState('')
  const [phoneOtpSent, setPhoneOtpSent] = useState(false)
  const [phoneVerificationBusy, setPhoneVerificationBusy] = useState(false)

  const load = useCallback(async () => {
    const [{ data: { user } }, setting] = await Promise.all([
      supabase.auth.getUser(),
      getPaymentQrSetting(),
    ])
    setFee(setting.feeAmount)
    if (!user) {
      setPayments([])
      return
    }
    await syncXenditShopPayment().catch(() => undefined)
    const [paymentResult, shopResult] = await Promise.all([
      supabase
        .from('shop_payments')
        .select('id, status, amount, \x22referenceNumber\x22, \x22createdAt\x22, \x22verifiedAt\x22, \x22expiresAt\x22, \x22rejectionReason\x22, \x22payerName\x22, \x22paymentProvider\x22, \x22providerCheckoutUrl\x22, \x22providerPaymentId\x22, \x22providerPaymentMethod\x22')
        .eq('shopId', user.id)
        .order('createdAt', { ascending: false }),
      supabase
        .from('funeral_shops')
        .select('shopName, shopPhoneNumber')
        .eq('id', user.id)
        .maybeSingle(),
    ])
    if (paymentResult.error) throw paymentResult.error
    const resolvedShopName = shopResult.data?.shopName || 'Funeral shop'
    const authPhone = String(user.phone || '')
    const isPhoneConfirmed = Boolean(authPhone && user.phone_confirmed_at)
    setShopName(resolvedShopName)
    setVerifiedPhone(isPhoneConfirmed ? authPhone : '')
    setPhoneInput(current => current || authPhone || String(shopResult.data?.shopPhoneNumber || ''))
    setPayments((paymentResult.data || []).map((row: any) => ({
      id: row.id,
      status: row.status || 'pending',
      amount: Number(row.amount) || 0,
      referenceNumber: row.referenceNumber || '',
      createdAt: row.createdAt || '',
      verifiedAt: row.verifiedAt || null,
      expiresAt: row.expiresAt || null,
      rejectionReason: row.rejectionReason || null,
      payerName: row.payerName || null,
      paymentProvider: row.paymentProvider === 'xendit'
        ? 'xendit'
        : row.paymentProvider === 'paymongo'
          ? 'paymongo'
          : 'manual',
      providerCheckoutUrl: row.providerCheckoutUrl || null,
      providerPaymentId: row.providerPaymentId || null,
      providerPaymentMethod: row.providerPaymentMethod || null,
    })))
  }, [])

  useEffect(() => {
    let active = true
    load().catch(() => undefined).finally(() => active && setReady(true))
    const channel = supabase.channel('shop-xendit-web')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shop_payments' }, () => {
        void load().then(onSuccess).catch(() => undefined)
      }).subscribe()
    const refresh = () => {
      if (document.visibilityState === 'visible') void load().then(onSuccess).catch(() => undefined)
    }
    document.addEventListener('visibilitychange', refresh)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', refresh)
      void supabase.removeChannel(channel)
    }
  }, [load, onSuccess])

  const latestPending = useMemo(
    () => payments.find((payment) => payment.status === 'pending') || null,
    [payments],
  )

  const confirmLifecyclePassword = async () => {
    if (!accountPassword || checkingPassword) return
    setCheckingPassword(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user?.email) throw new Error('Your signed-in email is unavailable.')
      const result = await supabase.auth.signInWithPassword({ email: user.email, password: accountPassword })
      if (result.error || result.data.user?.id !== user.id) throw new Error('Your LifeCycle password is incorrect.')
      setAccountPassword('')
      setPasswordConfirmed(true)
    } catch (error) {
      setPasswordConfirmed(false)
      openAlert({ title: 'Password not confirmed', message: error instanceof Error ? error.message : 'Please try again.', tone: 'danger', okLabel: 'Close' })
    } finally {
      setCheckingPassword(false)
    }
  }

  const sendPhoneVerification = async () => {
    const normalizedPhone = normalizePhilippinePhone(phoneInput)
    if (!normalizedPhone) {
      openAlert({ title: 'Invalid mobile number', message: 'Enter a Philippine mobile number such as 09XX XXX XXXX.', tone: 'warning', okLabel: 'Got It' })
      return
    }
    setPhoneVerificationBusy(true)
    try {
      const { error } = await supabase.auth.updateUser({ phone: normalizedPhone })
      if (error) throw error
      setPendingPhone(normalizedPhone)
      setPhoneOtp('')
      setPhoneOtpSent(true)
      openAlert({ title: 'Verification code sent', message: 'Enter the six-digit code sent to this mobile number.', tone: 'info', okLabel: 'Continue' })
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : ''
      const providerUnavailable = /phone provider|sms provider|unsupported|not enabled/i.test(rawMessage)
      openAlert({
        title: 'Unable to send code',
        message: providerUnavailable
          ? 'Real SMS verification is not enabled in Supabase yet. An administrator must connect an SMS provider first.'
          : rawMessage || 'Please try again.',
        tone: 'danger',
        okLabel: 'Close',
      })
    } finally {
      setPhoneVerificationBusy(false)
    }
  }

  const verifyPhoneCode = async () => {
    if (!pendingPhone || !/^\d{6}$/.test(phoneOtp.trim())) {
      openAlert({ title: 'Verification code required', message: 'Enter the six-digit SMS code.', tone: 'warning', okLabel: 'Got It' })
      return
    }
    setPhoneVerificationBusy(true)
    try {
      const { error } = await supabase.auth.verifyOtp({ phone: pendingPhone, token: phoneOtp.trim(), type: 'phone_change' })
      if (error) throw error
      const { data: { user } } = await supabase.auth.getUser()
      if (!user?.phone || !user.phone_confirmed_at) throw new Error('The mobile number was not confirmed.')
      const { error: shopError } = await supabase.from('funeral_shops').update({ shopPhoneNumber: user.phone }).eq('id', user.id)
      if (shopError) throw shopError
      setVerifiedPhone(user.phone)
      setPhoneInput(user.phone)
      setPhoneOtp('')
      setPhoneOtpSent(false)
      openAlert({ title: 'Mobile number verified', message: 'This number is now linked to the shop owner. LifeCycle payment notifications remain enabled.', tone: 'info', okLabel: 'Done' })
    } catch (error) {
      openAlert({ title: 'Code not verified', message: error instanceof Error ? error.message : 'Please request a new code.', tone: 'danger', okLabel: 'Close' })
    } finally {
      setPhoneVerificationBusy(false)
    }
  }

  const choosePaymentMethod = (nextMethod: XenditShopPaymentMethod) => {
    setPaymentMethod(nextMethod)
    setPaymentMethodMenuOpen(false)
    setAccountPassword('')
    setPasswordConfirmed(false)
  }

  const startCheckout = async () => {
    if (starting) return
    if (paymentMethod === 'gcash' && !verifiedPhone) {
      openAlert({ title: 'Verify your mobile number', message: 'GCash checkout requires a verified shop-owner mobile number.', tone: 'warning', okLabel: 'Got It' })
      return
    }
    if (paymentMethod === 'gcash' && !passwordConfirmed) {
      openAlert({ title: 'Confirm your password', message: 'Enter your LifeCycle account password before opening GCash checkout.', tone: 'warning', okLabel: 'Got It' })
      return
    }
    if (fee <= 0) {
      openAlert({ title: 'Payment unavailable', message: 'The registration fee has not been configured yet.', tone: 'warning', okLabel: 'Got It' })
      return
    }
    setStarting(true)
    try {
      const result = await createXenditShopCheckout(paymentMethod)
      if (result.paid) {
        setPurchaseConfirmOpen(false)
        await load()
        onSuccess?.()
        openAlert({ title: 'Payment received', message: 'Your Xendit test payment has been confirmed.', tone: 'info', okLabel: 'Done' })
        return
      }
      if (result.livemode !== false) throw new Error('Checkout was blocked because LifeCycle only allows Xendit test payments.')
      if (!result.checkoutUrl) throw new Error('Xendit did not return a checkout page.')
      window.location.assign(result.checkoutUrl)
    } catch (error) {
      openAlert({
        title: 'Unable to start payment',
        message: error instanceof Error ? error.message : 'Please try again.',
        tone: 'danger',
        okLabel: 'Close',
      })
      setStarting(false)
    }
  }

  if (!ready) return <div className='pm-card pm-loading'>Loading secure payment...</div>

  const manualPending = latestPending?.paymentProvider === 'manual'
  const returned = new URLSearchParams(window.location.search).get('xendit')
  const selectedMethod = PAYMENT_METHODS.find(method => method.id === paymentMethod) || PAYMENT_METHODS[0]

  return (
    <section className={'pm-card' + (className ? ` ${className}` : '')}>
      <div className='pm-hero'>
        <div className='pm-shield' aria-hidden='true'>✓</div>
        <div>
          <span className='pm-kicker'>SECURE CHECKOUT</span>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>

      {returned === 'success' && <div className='pm-banner success'>Checkout finished. We are confirming your payment now.</div>}
      {returned === 'cancelled' && <div className='pm-banner'>Checkout was cancelled. You can continue whenever you are ready.</div>}

      <div className='pm-amount'>
        <span>Registration / renewal fee</span>
        <strong>{peso(fee)}</strong>
      </div>

      {manualPending && (
        <div className='pm-banner warning'>Your previous manual payment is awaiting admin review. It must be resolved before Xendit checkout.</div>
      )}

      <button className='pm-pay' disabled={starting || fee <= 0 || manualPending} onClick={() => setPurchaseConfirmOpen(true)}>
        {latestPending?.paymentProvider === 'xendit' ? 'Review test checkout' : 'Review test payment'}
      </button>
      <p className='pm-safe'>Choose an available Xendit Test Mode e-wallet, card, QR Ph, or bank-transfer channel. Never enter real payment credentials.</p>

      <div className='pm-history'>
        <h4>Payment history</h4>
        {payments.length === 0 ? <p className='pm-empty'>No payments yet.</p> : payments.map((payment) => (
          <button
            type='button'
            className='pm-row pm-row-button'
            key={payment.id}
            onClick={() => setSelectedPayment(payment)}
            aria-label={`Open receipt for ${peso(payment.amount)} payment`}
          >
            <div>
              <strong>{peso(payment.amount)}</strong>
              <small>{payment.paymentProvider === 'xendit' ? 'Xendit' : payment.paymentProvider === 'paymongo' ? 'Legacy PayMongo' : 'Legacy manual'}{payment.providerPaymentMethod ? ` - ${payment.providerPaymentMethod.replace(/_/g, ' ')}` : ''} - {dateTime(payment.createdAt)}</small>
              {payment.rejectionReason && <small className='pm-reason'>{payment.rejectionReason}</small>}
            </div>
            <span className='pm-row-end'>
              <span className={'pm-status ' + payment.status}>{statusText(payment)}</span>
              <span className='pm-view-receipt'>View receipt</span>
            </span>
          </button>
        ))}
      </div>

      {purchaseConfirmOpen && (
        <div className='pm-purchase-overlay' role='presentation' onMouseDown={() => !starting && setPurchaseConfirmOpen(false)}>
          <section className='pm-purchase-sheet' role='dialog' aria-modal='true' aria-label='Confirm Xendit test payment' onMouseDown={event => event.stopPropagation()}>
            <div className='pm-purchase-handle' />
            <div className='pm-purchase-brand-row'>
              <strong>LifeCycle</strong>
              <span>TEST MODE</span>
            </div>
            <div className='pm-purchase-product-row'>
              <div className='pm-purchase-app-icon' aria-hidden='true'>LC</div>
              <div>
                <strong>LifeCycle Shop Registration</strong>
                <small>LifeCycle Admin</small>
              </div>
              <b>{peso(fee)}</b>
            </div>
            <div className='pm-purchase-divider' />
            <button type='button' className='pm-purchase-method-row' onClick={() => setPaymentMethodMenuOpen(open => !open)}>
              <div className='pm-purchase-card-icon' aria-hidden='true'>{selectedMethod.icon}</div>
              <div>
                <strong>{selectedMethod.label}</strong>
                <small>{selectedMethod.detail}</small>
              </div>
              <span className='pm-purchase-chevron' aria-hidden='true'>›</span>
            </button>
            {paymentMethodMenuOpen && (
              <div className='pm-method-menu' role='menu' aria-label='Payment methods'>
                {PAYMENT_METHODS.map(method => (
                  <button type='button' key={method.id} className={'pm-method-option' + (method.id === paymentMethod ? ' selected' : '')} onClick={() => choosePaymentMethod(method.id)}>
                    <span className='pm-method-icon' aria-hidden='true'>{method.icon}</span>
                    <span><strong>{method.label}</strong><small>{method.detail}</small></span>
                    {method.id === paymentMethod && <b aria-label='Selected'>✓</b>}
                  </button>
                ))}
              </div>
            )}
            {paymentMethod === 'gcash' && (
              <div className='pm-security-card'>
                <strong>Confirm shop owner</strong>
                {verifiedPhone ? (
                  <div className='pm-verified-row'><span aria-hidden='true'>✓</span><div><b>{maskPhone(verifiedPhone)}</b><small>Mobile number verified</small></div></div>
                ) : (
                  <div className='pm-verification-form'>
                    <input type='tel' value={phoneInput} onChange={event => setPhoneInput(event.target.value)} placeholder='09XX XXX XXXX' disabled={phoneVerificationBusy} autoComplete='tel' />
                    {phoneOtpSent && <input type='text' inputMode='numeric' value={phoneOtp} onChange={event => setPhoneOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder='6-digit SMS code' disabled={phoneVerificationBusy} autoComplete='one-time-code' />}
                    <button type='button' disabled={phoneVerificationBusy} onClick={() => void (phoneOtpSent ? verifyPhoneCode() : sendPhoneVerification())}>
                      {phoneVerificationBusy ? 'Please wait...' : phoneOtpSent ? 'Verify Code' : 'Send Verification Code'}
                    </button>
                  </div>
                )}
                {passwordConfirmed ? (
                  <div className='pm-verified-row'><span aria-hidden='true'>✓</span><div><b>Password confirmed</b><small>LifeCycle account re-authenticated</small></div></div>
                ) : (
                  <div className='pm-password-row'>
                    <input type='password' value={accountPassword} onChange={event => setAccountPassword(event.target.value)} placeholder='LifeCycle password' disabled={checkingPassword} autoComplete='current-password' />
                    <button type='button' disabled={!accountPassword || checkingPassword} onClick={() => void confirmLifecyclePassword()}>{checkingPassword ? 'Checking...' : 'Confirm'}</button>
                  </div>
                )}
                <small className='pm-security-note'>The verified number confirms the shop owner. Payment alerts are sent through LifeCycle notifications.</small>
              </div>
            )}
            <p>Click “Test Pay” to continue to Xendit’s hosted Test Mode checkout. Do not enter real payment credentials.</p>
            <button type='button' className='pm-purchase-buy' disabled={starting || (paymentMethod === 'gcash' && (!verifiedPhone || !passwordConfirmed))} onClick={() => void startCheckout()}>
              {starting ? 'Opening Xendit...' : 'Test Pay'}
            </button>
          </section>
        </div>
      )}

      {selectedPayment && (
        <div className='pm-receipt-overlay' role='presentation' onMouseDown={() => setSelectedPayment(null)}>
          <section
            className='pm-receipt-modal'
            role='dialog'
            aria-modal='true'
            aria-label='Registration payment receipt'
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className='pm-receipt-hero'>
              <button className='pm-receipt-x' type='button' onClick={() => setSelectedPayment(null)} aria-label='Close receipt'>×</button>
              <div className={'pm-receipt-status-icon ' + selectedPayment.status} aria-hidden='true'>
                {selectedPayment.status === 'verified' ? '✓' : selectedPayment.status === 'rejected' ? '!' : '…'}
              </div>
              <h3>{selectedPayment.status === 'verified' ? 'Payment Verified' : selectedPayment.status === 'rejected' ? 'Payment Not Completed' : 'Payment Pending'}</h3>
              <p>{receiptMessage(selectedPayment)}</p>
            </header>

            <div className='pm-receipt-body'>
              <h4>Payment Details</h4>
              <div className='pm-receipt-lines'>
                <ReceiptLine label='Payment Date' value={dateTime(selectedPayment.verifiedAt || selectedPayment.createdAt)} />
                <ReceiptLine label='Receipt No.' value={receiptNumber(selectedPayment)} />
                <ReceiptLine label='Shop' value={shopName} />
                {selectedPayment.expiresAt && <ReceiptLine label='Access Valid Until' value={dateTime(selectedPayment.expiresAt)} />}
              </div>

              <div className='pm-receipt-divider' />

              <div className='pm-receipt-service'>
                <div className='pm-receipt-logo' aria-hidden='true'>LC</div>
                <div>
                  <strong>LifeCycle registration</strong>
                  <small>Funeral shop subscription payment</small>
                </div>
                <b>{peso(selectedPayment.amount)}</b>
              </div>

              <div className='pm-receipt-divider' />

              <h4>Receipt Information</h4>
              <div className='pm-receipt-info'>
                <ReceiptLine label='Payment Method' value={selectedPayment.paymentProvider === 'xendit' ? `Xendit${selectedPayment.providerPaymentMethod ? ` - ${selectedPayment.providerPaymentMethod.replace(/_/g, ' ')}` : ''}` : selectedPayment.paymentProvider === 'paymongo' ? 'Legacy PayMongo' : 'Legacy manual'} />
                <ReceiptLine label='Paid By' value={selectedPayment.payerName || shopName} />
                <ReceiptLine label='Reference Number' value={selectedPayment.referenceNumber || 'Not provided'} />
                <ReceiptLine label='Provider Payment ID' value={selectedPayment.providerPaymentId || 'Pending'} />
                <ReceiptLine label='Status' value={statusText(selectedPayment)} />
                <ReceiptLine label='Amount' value={peso(selectedPayment.amount)} />
                {selectedPayment.verifiedAt && <ReceiptLine label='Confirmed At' value={dateTime(selectedPayment.verifiedAt)} />}
              </div>

              {selectedPayment.paymentProvider === 'xendit' && (
                <div className={'pm-receipt-provider-note ' + (selectedPayment.status === 'verified' ? 'verified' : 'pending')}>
                  <strong>{selectedPayment.status === 'verified' ? 'Verified by Xendit' : 'Xendit confirmation pending'}</strong>
                  <span>{selectedPayment.status === 'verified' ? 'LifeCycle verified this payment directly with Xendit. No screenshot or manual admin approval was required.' : 'This receipt will update automatically after Xendit confirms the Test Mode payment.'}</span>
                </div>
              )}

              {selectedPayment.rejectionReason && <div className='pm-receipt-error'>{selectedPayment.rejectionReason}</div>}

              {selectedPayment.status === 'pending' && selectedPayment.paymentProvider === 'xendit' && selectedPayment.providerCheckoutUrl && (
                <button className='pm-receipt-primary' type='button' onClick={() => window.location.assign(selectedPayment.providerCheckoutUrl!)}>Continue Xendit Checkout</button>
              )}
              <button className='pm-receipt-secondary' type='button' onClick={() => setSelectedPayment(null)}>Close Receipt</button>
            </div>
          </section>
        </div>
      )}
      {alertDialog}
    </section>
  )
}

function ReceiptLine({ label, value }: { label: string; value: string }) {
  return <div className='pm-receipt-line'><span>{label}</span><strong>{value}</strong></div>
}
