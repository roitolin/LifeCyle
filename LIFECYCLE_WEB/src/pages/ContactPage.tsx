import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'
import ProfileLayout from './ProfileLayout'
import { useAlertDialog } from '@/hooks/useAlertDialog'

const SUPPORT_EMAIL = 'support@lifecycle.ph'

export default function ContactPage() {
  const [viewer, setViewer] = useState<User | null>(null)
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [searchParams] = useSearchParams()
  const { openAlert, alertDialog } = useAlertDialog()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setViewer(data.session?.user ?? null)
    })
    const requestedSubject = searchParams.get('subject')
    if (requestedSubject) setSubject(requestedSubject)
  }, [searchParams])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!subject.trim() || !message.trim()) {
      openAlert({
        title: 'Incomplete Details',
        message: 'Please fill in both subject and message.',
        tone: 'warning',
        okLabel: 'Got It',
      })
      return
    }
    if (!viewer) {
      openAlert({
        title: 'Sign In Required',
        message: 'Please log in first.',
        tone: 'warning',
        okLabel: 'Got It',
      })
      return
    }

    setLoading(true)
    try {
      /* Insert into support_messages table (same as mobile fallback) */
      const { error } = await supabase.from('support_messages').insert({
        userId: viewer.id,
        email: viewer.email || null,
        subject: subject.trim(),
        message: message.trim(),
        read: false,
        status: 'open',
        channel: 'web_contact',
      })
      if (error) throw error

      setSubject('')
      setMessage('')
      setSent(true)
    } catch (err: any) {
      openAlert({
        title: 'Message Not Sent',
        message: 'Failed to send message: ' + (err?.message || 'Unknown error'),
        tone: 'danger',
        okLabel: 'Dismiss',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <ProfileLayout title="Contact Support" subtitle="Have a question, suggestion, or issue? Let us know and we'll get back to you.">
      <div className="contact-content">
        {sent ? (
          <div className="success-banner">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            <h2>Message Sent!</h2>
            <p>Your support message was sent successfully. Our admin team will review and respond soon.</p>
            <button className="btn-save" onClick={() => setSent(false)} style={{ marginTop: 16 }}>Send Another</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="contact-form">
            <div className="contact-info-bar">
              <p>You can also email us directly at <strong>{SUPPORT_EMAIL}</strong></p>
            </div>

            <div className="form-group" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
              <label style={{ textAlign: 'left', width: 'auto', paddingRight: 0, marginBottom: 8 }}>Subject</label>
              <input
                type="text"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="Brief subject of your concern"
                style={{ maxWidth: '100%', width: '100%' }}
              />
            </div>
            <div className="form-group" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
              <label style={{ textAlign: 'left', width: 'auto', paddingRight: 0, marginBottom: 8 }}>Message</label>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Describe your question, issue, or suggestion..."
                rows={6}
                className="contact-textarea"
              />
            </div>
            <button type="submit" disabled={loading} className="btn-save">
              {loading ? 'Sending...' : 'Send Message'}
            </button>
          </form>
        )}
      </div>
      {alertDialog}
    </ProfileLayout>
  )
}
