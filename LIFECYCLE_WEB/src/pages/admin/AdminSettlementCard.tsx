import { useEffect, useState, type FormEvent } from 'react'
import { getAdminSettlementAccount, saveAdminSettlementAccount, type AdminSettlementAccount } from '@/utils/adminSettlementAccount'

const emptyAccount: Omit<AdminSettlementAccount, 'updatedAt'> = {
  channel: 'bank', providerName: '', accountHolder: '', accountNumber: '',
}

export default function AdminSettlementCard() {
  const [account, setAccount] = useState(emptyAccount)
  const [saved, setSaved] = useState(false)
  const [editing, setEditing] = useState(false)
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    getAdminSettlementAccount().then((data) => {
      if (!active || !data) return
      setAccount({ channel: data.channel, providerName: data.providerName, accountHolder: data.accountHolder, accountNumber: data.accountNumber })
      setUpdatedAt(data.updatedAt)
      setSaved(true)
    }).catch(() => {
      if (active) setError('Unable to load the settlement account.')
    })
    return () => { active = false }
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (account.providerName.trim().length < 2 || account.accountHolder.trim().length < 2 || !/^[0-9A-Za-z -]{6,40}$/.test(account.accountNumber.trim())) {
      setError('Enter a provider, account holder, and valid account or mobile number (6–40 characters).')
      return
    }
    setBusy(true)
    setError('')
    try {
      await saveAdminSettlementAccount(account)
      setSaved(true)
      setEditing(false)
      setVisible(false)
      setUpdatedAt(new Date().toISOString())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save the settlement account.')
    } finally {
      setBusy(false)
    }
  }

  const number = visible ? account.accountNumber : `•••• ${account.accountNumber.slice(-4)}`

  return (
    <section className="payments-card payments-settlement-card">
      <div className="payments-card-head">
        <h3>Platform receiver account</h3>
        <p>Record the bank or wallet used for withdrawals from the LifeCycle Xendit balance.</p>
      </div>
      {saved && !editing ? (
        <div className="payments-settlement-preview">
          <div className="payments-settlement-preview-top">
            <span className="payments-settlement-mark">LC</span>
            <span className="payments-settlement-type">{account.channel === 'bank' ? 'BANK ACCOUNT' : 'E-WALLET'}</span>
          </div>
          <strong>{account.providerName}</strong>
          <span>{account.accountHolder}</span>
          <div className="payments-settlement-number">
            <span>{number}</span>
            <button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? 'Hide account number' : 'Show account number'}>{visible ? 'Hide' : 'Show'}</button>
          </div>
          <small>Updated {updatedAt ? new Date(updatedAt).toLocaleDateString('en-PH') : 'recently'}</small>
        </div>
      ) : null}
      {(!saved || editing) ? (
        <form className="payments-settlement-form" onSubmit={(event) => void submit(event)}>
          <label>Account type
            <select value={account.channel} onChange={(event) => setAccount({ ...account, channel: event.target.value as 'bank' | 'ewallet' })}>
              <option value="bank">Bank account</option><option value="ewallet">E-wallet</option>
            </select>
          </label>
          <label>Bank or wallet provider
            <input required maxLength={80} value={account.providerName} onChange={(event) => setAccount({ ...account, providerName: event.target.value })} placeholder="e.g. BDO Unibank" />
          </label>
          <label>Account holder name
            <input required maxLength={120} value={account.accountHolder} onChange={(event) => setAccount({ ...account, accountHolder: event.target.value })} placeholder="Registered account name" />
          </label>
          <label>Account or mobile number
            <input required maxLength={40} autoComplete="off" value={account.accountNumber} onChange={(event) => setAccount({ ...account, accountNumber: event.target.value })} placeholder="Account number" />
          </label>
          <div className="payments-settlement-actions">
            {saved ? <button type="button" className="ghost-btn" onClick={() => setEditing(false)}>Cancel</button> : null}
            <button type="submit" className="solid-btn" disabled={busy}>{busy ? 'Saving...' : 'Save account'}</button>
          </div>
        </form>
      ) : <button type="button" className="ghost-btn payments-settlement-edit" onClick={() => setEditing(true)}>Edit account</button>}
      {error ? <p className="auth-message auth-message-error">{error}</p> : null}
      <p className="payments-settlement-note">Shop activation and renewal fees go through Xendit checkout. This record does not change where Xendit sends withdrawals. Add the same account in the <a href="https://dashboard.xendit.co/" target="_blank" rel="noopener noreferrer">Xendit Dashboard</a> and enable withdrawals there. Checkout is currently in Test Mode.</p>
    </section>
  )
}
