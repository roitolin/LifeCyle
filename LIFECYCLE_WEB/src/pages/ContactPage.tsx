import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'
import ProfileLayout from './ProfileLayout'
import { useAlertDialog } from '@/hooks/useAlertDialog'

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
        title: 'Incomplete details',
        message: 'Please fill in both subject and message.',
        tone: 'warning',
        okLabel: 'OK',
      })
      return
    }
    if (!viewer) {
      openAlert({
        title: 'Sign in required',
        message: 'Please log in first.',
        tone: 'warning',
        okLabel: 'OK',
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
        title: 'Message not sent',
        message: 'Failed to send message: ' + (err?.message || 'Unknown error'),
        tone: 'danger',
        okLabel: 'Dismiss',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <ProfileLayout title="Contact support" subtitle="Send a question or report an issue with your account or service request.">
      <div className="contact-content">
        {sent ? (
          <div className="success-banner">
            <h2>Message sent</h2>
            <p>Your message is now available to the support team for review.</p>
            <button className="btn-save contact-success-action" onClick={() => setSent(false)}>Send another message</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="contact-form">
            <div className="form-group contact-field">
              <label>Subject</label>
              <input
                type="text"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="e.g. Payment question"
              />
            </div>
            <div className="form-group contact-field">
              <label>Message</label>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Include the relevant details and any service-request reference"
                rows={6}
                className="contact-textarea"
              />
            </div>
            <button type="submit" disabled={loading} className="btn-save">
              {loading ? 'Sending…' : 'Send message'}
            </button>
          </form>
        )}
      </div>
      {alertDialog}
    </ProfileLayout>
  )
}
