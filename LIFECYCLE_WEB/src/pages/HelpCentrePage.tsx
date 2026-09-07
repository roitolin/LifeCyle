import { useState } from 'react'
import ProfileLayout from './ProfileLayout'

const faqs = [
  {
    q: 'How do I find a funeral shop?',
    a: 'Open Funeral shops from the marketplace to browse active providers. Each shop page shows its available products and published contact details.',
  },
  {
    q: 'How do I send a service request?',
    a: 'Add products from one shop to your cart, continue to checkout, and review the service and contact details before submitting. A checkout submission creates a request for that shop.',
  },
  {
    q: 'Where can I check a request?',
    a: 'Open Service requests from your account. Select a request to view its current status, payment details, and any available actions.',
  },
  {
    q: 'How does payment verification work?',
    a: 'Follow the payment instructions published for the request, then upload a clear receipt. The payment status changes only after the submitted proof has been reviewed.',
  },
  {
    q: 'How do I ask about a cancellation or refund?',
    a: 'Use the controls shown on the service request when available. If no action is available, send the request details through Contact support. Approval depends on the request and payment status.',
  },
  {
    q: 'How do I register a funeral shop?',
    a: 'Open Seller Centre, register a shop, and submit the required information for review. Shop tools become available after the application and publication requirements are completed.',
  },
  {
    q: 'How do I contact support?',
    a: 'Open Contact support from your account, enter a subject and message, then submit the form. You can include a service-request reference in the message when relevant.',
  },
]

export default function HelpCentrePage() {
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  return (
    <ProfileLayout title="Help Centre" subtitle="Common questions about shops, service requests, and payments.">
      <div className="help-content">
        <div className="help-intro">
          <h2>Using LifeCycle</h2>
          <p>Select a question to view the answer.</p>
        </div>

        <section className="help-card" aria-label="Frequently asked questions">
          <div className="help-faq-list">
            {faqs.map((item, index) => {
              const isOpen = openIndex === index
              return (
                <div key={item.q} className={`help-faq-item${isOpen ? ' open' : ''}`}>
                  <button
                    type="button"
                    className="help-faq-question"
                    aria-expanded={isOpen}
                    onClick={() => setOpenIndex(isOpen ? null : index)}
                  >
                    <span>{item.q}</span>
                    <svg className="help-faq-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
                  </button>
                  {isOpen && <div className="help-faq-answer">{item.a}</div>}
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </ProfileLayout>
  )
}
