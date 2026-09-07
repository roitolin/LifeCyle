import { Link } from 'react-router-dom'
import BrandLogo from '@/components/BrandLogo'
import './FuneralLandingPage.css'

const sections = [
  {
    title: '1. Information We Collect',
    body: 'LifeCycle collects the information you provide when you create and use an account, including profile details, contact information, service-request details, payment receipts, messages, and support submissions. Seller accounts may also provide shop, listing, schedule, and payment-instruction information.',
  },
  {
    title: '2. How We Use Your Information',
    body: 'We use this information to authenticate accounts, operate service requests, enable communication with funeral shops, review submitted payment receipts, send relevant notifications, provide support, and maintain platform security.',
  },
  {
    title: '3. How We Share Your Information',
    body: 'Information from a service request is shared with the selected funeral shop so it can review and coordinate the arrangement. We may also use service providers that host or operate parts of LifeCycle. We do not sell personal information.',
  },
  {
    title: '4. Data Security',
    body: 'We take reasonable measures to protect your information from unauthorised access, alteration, disclosure, or destruction. However, no method of transmission or storage over the internet is completely secure, and we cannot guarantee absolute security.',
  },
  {
    title: '5. Your Choices',
    body: 'You can review and update account details from your profile. Privacy & data provides the available account-data and deletion controls. You can also contact support if an available control does not cover your request.',
  },
  {
    title: '6. Cookies and Analytics',
    body: 'Our website may use cookies and similar technologies to remember your preferences, keep you signed in, and understand how the site is used so we can improve it. You can control cookies through your browser settings.',
  },
  {
    title: '7. Changes to This Policy',
    body: 'We may update this Privacy Policy from time to time. Any changes will be posted on this page, and where appropriate, we will notify you by email or in-app notice.',
  },
  {
    title: '8. Contact Us',
    body: 'If you have a question about this policy or how your data is handled, use the Contact support page while signed in.',
  },
]

export default function PrivacyPolicyPage() {
  return (
    <div className="sp-page">
      <header className="sp-header">
        <div className="sp-header-inner policy-header-inner">
          <BrandLogo />
          <Link to="/funeral" className="policy-back-link">Back to Home</Link>
        </div>
      </header>

      <div className="sp-body">
        <div className="sp-body-inner policy-body-inner">
          <div className="policy-content">
            <span className="policy-kicker">LifeCycle Funeral Services Philippines</span>
            <h1>Privacy Policy</h1>
            <p className="policy-updated">Last updated: {new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
            <p className="policy-intro">
              This Privacy Policy explains how LifeCycle collects, uses, and protects your personal information when you use our website and services. By using LifeCycle, you agree to the practices described here.
            </p>
            {sections.map(s => (
              <div key={s.title} className="policy-section">
                <h2>{s.title}</h2>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <footer className="sp-footer">
        <div className="sp-footer-bottom">
          <span>© {new Date().getFullYear()} LifeCycle Funeral Services Philippines.</span>
        </div>
      </footer>
    </div>
  )
}
