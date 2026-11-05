import { useEffect, useState, type FormEvent } from 'react'
import { PAYOUT_CHANNELS, type PayoutChannel } from './adminPayoutChannels'
import { getAdminSettlementAccount, saveAdminSettlementAccount, type AdminSettlementAccount } from '@/utils/adminSettlementAccount'

type Draft = { accountHolder: string; accountNumber: string }
const mask = (value: string) => `•••• ${value.slice(-4)}`

export default function AdminSettlementCard() {
  const [saved, setSaved] = useState<AdminSettlementAccount | null>(null)
  const [selected, setSelected] = useState<PayoutChannel | null>(null)
  const [draft, setDraft] = useState<Draft>({ accountHolder: '', accountNumber: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showNumber, setShowNumber] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    getAdminSettlementAccount().then((account) => { if (active) setSaved(account) })
      .catch(() => { if (active) setError('Unable to load the receiver account.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const savedChannel: PayoutChannel | null = saved
    ? PAYOUT_CHANNELS.find((item) => item.label === saved.providerName && item.type === (saved.channel === 'ewallet' ? 'wallet' : 'bank'))
      || { code: 'saved', label: saved.providerName, type: saved.channel === 'ewallet' ? 'wallet' : 'bank', shortName: saved.providerName.slice(0, 2).toUpperCase(), logoUrl: '' }
    : null

  const openSetup = (channel: PayoutChannel) => {
    const same = saved?.providerName === channel.label && saved.channel === (channel.type === 'wallet' ? 'ewallet' : 'bank')
    setSelected(channel)
    setDraft({ accountHolder: same ? saved.accountHolder : '', accountNumber: same ? saved.accountNumber : '' })
    setShowNumber(false)
    setError('')
  }
  const back = () => { setSelected(null); setError('') }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!selected || saving) return
    const accountHolder = draft.accountHolder.trim()
    const accountNumber = draft.accountNumber.trim().replace(/[\s-]+/g, '')
    if (accountHolder.length < 2 || accountHolder.length > 120 || !/^[0-9A-Za-z]{6,30}$/.test(accountNumber) || (selected.type === 'wallet' && !/^09\d{9}$/.test(accountNumber))) {
      setError(selected.type === 'wallet' ? 'Enter the registered name and an 11-digit mobile number beginning with 09.' : 'Enter the registered name and a valid bank account number.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const account = { channel: selected.type === 'wallet' ? 'ewallet' as const : 'bank' as const, providerName: selected.label, accountHolder, accountNumber }
      await saveAdminSettlementAccount(account)
      setSaved({ ...account, updatedAt: new Date().toISOString() })
      setSelected(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save the receiver account.')
    } finally { setSaving(false) }
  }

  const logo = (channel: PayoutChannel) => channel.logoUrl
    ? <img src={channel.logoUrl} alt="" aria-hidden="true" />
    : <span aria-hidden="true">{channel.shortName}</span>

  return <section className="payments-settlement-card" aria-label="Platform receiver account setup">
    {selected ? <div className="payments-receiver-setup">
      <button type="button" className="payments-receiver-back" onClick={back}>← Payout destinations</button>
      <div className="payments-receiver-panel">
        <header className="payments-receiver-setup-head">
          <span className="payments-receiver-logo">{logo(selected)}</span>
          <div><span>{selected.type === 'wallet' ? 'E-wallet receiver' : 'Bank receiver'}</span><h3>{saved?.providerName === selected.label ? 'Edit' : 'Add'} {selected.label}</h3><p>Set the preferred platform receiver account for {selected.label}.</p></div>
        </header>
        <form className="payments-receiver-form" onSubmit={(event) => void submit(event)}>
          <div className="payments-receiver-readonly"><span>Selected destination</span><strong>{selected.label}</strong></div>
          {saved && saved.providerName !== selected.label ? <div className="payments-receiver-replace">Saving this destination will replace the current preferred account ({saved.providerName}).</div> : null}
          <label><span>Registered account holder</span><input required maxLength={120} autoComplete="name" value={draft.accountHolder} placeholder={selected.type === 'wallet' ? 'Name registered to the wallet' : 'Name registered to the bank account'} onChange={(event) => setDraft({ ...draft, accountHolder: event.target.value })} /></label>
          <label><span>{selected.type === 'wallet' ? 'Registered mobile number' : 'Bank account number'}</span><input required inputMode="numeric" maxLength={30} autoComplete="off" value={draft.accountNumber} placeholder={selected.type === 'wallet' ? '09XXXXXXXXX' : 'Enter account number'} onChange={(event) => setDraft({ ...draft, accountNumber: event.target.value })} /><small>Enter the exact details registered with {selected.label}.</small></label>
          <div className="payments-receiver-notice"><strong>Xendit setup required</strong><span>Saving this record does not configure Xendit withdrawals. Add the same destination in your Xendit Dashboard.</span></div>
          {error ? <p className="auth-message auth-message-error" role="alert">{error}</p> : null}
          <footer><button type="button" className="ghost-btn" onClick={back}>Cancel</button><button type="submit" className="solid-btn" disabled={saving}>{saving ? 'Saving...' : 'Save receiver account'}</button></footer>
        </form>
      </div>
    </div> : <>
      <header className="payments-receiver-heading"><span>Finance</span><h3>Platform receiver account</h3><p>Choose a bank or wallet and record one preferred destination for the LifeCycle Xendit balance.</p></header>
      {loading ? <p className="payments-receiver-loading">Loading receiver account...</p> : null}
      {!loading && <>
        <div className="payments-receiver-summary"><div><span>Accounts set up</span><strong>{saved ? 1 : 0}</strong><small>One preferred destination</small></div><div><span>Checkout</span><strong>Xendit</strong><small>Currently in Test Mode</small></div></div>
        <div className="payments-receiver-notice"><strong>Settlement setup</strong><span>Shop activation and renewal fees use Xendit checkout. This account is a record for your team; <a href="https://dashboard.xendit.co/" target="_blank" rel="noopener noreferrer">configure withdrawals in Xendit</a> separately.</span></div>
        <section className="payments-receiver-panel"><header><span>Receiver account</span><h4>Preferred destination</h4></header>
          {saved && savedChannel ? <div className="payments-receiver-saved">
            <span className="payments-receiver-logo">{logo(savedChannel)}</span>
            <div className="payments-receiver-saved-copy"><span>{saved.channel === 'ewallet' ? 'E-wallet' : 'Philippine bank'}</span><strong>{saved.providerName}</strong><p>{saved.accountHolder}</p><small>{showNumber ? saved.accountNumber : mask(saved.accountNumber)}</small></div>
            <span className="payments-receiver-recorded">Recorded only</span>
            <div className="payments-receiver-saved-actions"><button type="button" onClick={() => setShowNumber(!showNumber)}>{showNumber ? 'Hide number' : 'Show number'}</button><button type="button" onClick={() => openSetup(savedChannel)}>Edit</button></div>
          </div> : <div className="payments-receiver-empty"><strong>No receiver account yet</strong><span>Choose GCash, Maya, or a Philippine bank below to set up the preferred account.</span></div>}
        </section>
        <section className="payments-receiver-panel payments-receiver-methods"><header><span>Payout destinations</span><h4>Add or change a receiver</h4><p>Each option opens its own account details form.</p></header>
          {(['wallet', 'bank'] as const).map((type) => <div className="payments-receiver-group" key={type}><span>{type === 'wallet' ? 'E-wallets' : 'Philippine banks'}</span>
            {PAYOUT_CHANNELS.filter((channel) => channel.type === type).map((channel) => <button type="button" className="payments-receiver-row" key={channel.code} onClick={() => openSetup(channel)}>
              <span className="payments-receiver-logo">{logo(channel)}</span><span className="payments-receiver-row-copy"><strong>{saved?.providerName === channel.label ? channel.label : `Add ${channel.label}`}</strong><small>{saved?.providerName === channel.label ? `${saved.accountHolder} · ${mask(saved.accountNumber)}` : type === 'wallet' ? 'Set up an e-wallet receiver' : 'Set up a bank receiver account'}</small></span><span className="payments-receiver-row-state">{saved?.providerName === channel.label ? 'Recorded' : 'Add'}</span><span aria-hidden="true">›</span>
            </button>)}</div>)}
        </section>
      </>}
      {error ? <p className="auth-message auth-message-error" role="alert">{error}</p> : null}
    </>}
  </section>
}
