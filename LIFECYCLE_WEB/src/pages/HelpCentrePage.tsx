import { useState } from 'react'
import ProfileLayout from './ProfileLayout'

const faqs = [
  {
    q: 'How do I find a funeral shop?',
    a: 'From the LifeCycle home page, open the Funeral Shops section to browse verified providers. You can compare their profiles, products, and ratings before making a decision.',
  },
  {
    q: 'How do I place an order?',
    a: 'Browse a shop\'s products, add your chosen items to the cart, and proceed to checkout. You can send service details and track the status of your request from the shop centre.',
  },
  {
    q: 'How do I track my order or service request?',
    a: 'Open your Purchases page or the shop centre to see the current status. Shops update the status as they process, ship, and complete your order.',
  },
  {
    q: 'Can I cancel an order?',
    a: 'Yes. Open the order in your Purchases page and request a cancellation. The shop must approve the cancellation before it is finalised.',
  },
  {
    q: 'How do I become a seller?',
    a: 'Register an account and apply to open a funeral shop from the seller centre. Your application will be reviewed and, once verified, you can list products and manage orders.',
  },
  {
    q: 'How do I update my shop profile and cover photos?',
    a: 'Go to your Seller Centre, open the Shop Profile tab, and use the Upload Cover and Upload Profile buttons to set your shop\'s banner and logo.',
  },
  {
    q: 'How do I contact support?',
    a: 'Open the Contact Support page from the Support & Feedback menu to send us a message. We typically respond within 24 hours.',
  },
]

export default function HelpCentrePage() {
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  const toggleFaq = (index: number) => setOpenIndex(openIndex === index ? null : index)

  return (
    <ProfileLayout title="Help Centre" subtitle="Answers to common questions about using LifeCycle.">
      <div className="help-content">
        {/* Hero Banner */}
        <div className="help-hero">
          <span className="help-badge">We're here for you</span>
          <h2 className="help-hero-title">How can we help?</h2>
          <p className="help-hero-subtitle">
            Browse our frequently asked questions to find answers quickly.
          </p>
          <div className="help-highlights">
            <div className="help-highlight-card">
              <div className="help-highlight-value">24/7</div>
              <div className="help-highlight-label">Family Support</div>
            </div>
            <div className="help-highlight-card">
              <div className="help-highlight-value">24hrs</div>
              <div className="help-highlight-label">Response Time</div>
            </div>
            <div className="help-highlight-card">
              <div className="help-highlight-value">FAQ</div>
              <div className="help-highlight-label">Guides</div>
            </div>
          </div>
        </div>

        {/* FAQ */}
        <div className="help-card">
          <div className="help-card-header">
            <span className="help-card-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            </span>
            <h3>Frequently Asked Questions</h3>
          </div>
          <div className="help-faq-list">
            {faqs.map((item, index) => (
              <div key={item.q} className={`help-faq-item${openIndex === index ? ' open' : ''}`}>
                <button type="button" className="help-faq-question" onClick={() => toggleFaq(index)}>
                  <span>{item.q}</span>
                  <svg className="help-faq-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                {openIndex === index && <div className="help-faq-answer">{item.a}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </ProfileLayout>
  )
}
