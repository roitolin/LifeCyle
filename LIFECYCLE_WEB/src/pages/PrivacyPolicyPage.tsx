import { Link } from 'react-router-dom'
import './FuneralLandingPage.css'

const sections = [
  {
    title: '1. Information We Collect',
    body: 'LifeCycle collects the information you provide when you create an account, such as your name, email address, phone number, delivery address, and payment information. We also collect information about your shop, products, and orders if you use the seller tools, as well as usage data such as the pages you visit and the device you use.',
  },
  {
    title: '2. How We Use Your Information',
    body: 'We use your information to operate the platform: to verify your identity, process your orders and service requests, enable communication between families and funeral shops, send you updates about your transactions, provide customer support, and improve our services.',
  },
  {
    title: '3. How We Share Your Information',
    body: 'We share your information only as needed to provide the services, for example with funeral shops when you place an order, with logistics partners to deliver purchases, and with payment providers to process payments. We do not sell your personal information.',
  },
  {
    title: '4. Data Security',
    body: 'We take reasonable measures to protect your information from unauthorised access, alteration, disclosure, or destruction. However, no method of transmission or storage over the internet is completely secure, and we cannot guarantee absolute security.',
  },
  {
    title: '5. Your Choices',
    body: 'You can review and update your account details at any time from the My Account page. You may request deletion of your account or a copy of your data by contacting our support team.',
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
    body: 'If you have any questions about this Privacy Policy or how your data is handled, please reach out through the Contact Support page or email us at support@lifecycle.ph.',
  },
]

export default function PrivacyPolicyPage() {
  return (
    <div className="sp-page">
      <header className="sp-header">
        <div className="sp-header-inner" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Link to="/funeral" className="sp-logo">
            <div className="sp-logo-box">LC</div>
            <span>LifeCycle</span>
          </Link>
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
          <span>(c) {new Date().getFullYear()} LifeCycle Funeral Services Philippines. All Rights Reserved.</span>
        </div>
      </footer>
    </div>
  )
}
