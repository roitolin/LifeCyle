import { Link } from 'react-router-dom'
import './FuneralLandingPage.css'

const sections = [
  {
    title: '1. Payment Methods',
    body: 'We accept GCash, Maya, Visa, Mastercard, and Cash on Delivery (COD). Payments are processed securely through our payment providers. Please verify the payment details and amount before completing any transaction.',
  },
  {
    title: '2. Shipping and Delivery',
    body: 'Orders are delivered nationwide through our logistics partners, including LBC, J&T Express, Flash Express, and 2GO. Delivery timelines vary by location. You can track the status of your order from the Purchases page or the relevant shop centre.',
  },
  {
    title: '3. Return and Refund',
    body: 'If your item arrives damaged, incorrect, or does not match its description, you may request a return or refund within a reasonable time from delivery. Refunds are issued to the original payment method once the seller and LifeCycle approve the request.',
  },
  {
    title: '4. Order Cancellation',
    body: 'You may request cancellation of an order before it is processed or shipped. Cancellation is subject to seller approval. Once approved, any payment made will be refunded to the original payment method.',
  },
  {
    title: '5. LifeCycle Guarantee',
    body: 'LifeCycle is committed to verified funeral service providers. We encourage families to review shop profiles and ratings before purchasing. If you encounter an issue that cannot be resolved with the shop, contact our support team and we will help mediate.',
  },
  {
    title: '6. Seller Policies',
    body: 'Funeral shops must keep their product listings, prices, and stock levels accurate and up to date. Sellers are expected to process orders promptly and communicate clearly with families. Repeated violations may result in the suspension of shop privileges.',
  },
  {
    title: '7. Acceptable Use',
    body: 'Users must not upload illegal, fraudulent, or harmful content, or misuse the platform for purposes other than coordinating funeral services. We may suspend accounts that violate these terms.',
  },
  {
    title: '8. Contact Us',
    body: 'For questions about these policies, please reach out through the Contact Support page or email us at support@lifecycle.ph.',
  },
]

export default function PoliciesPage() {
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
            <h1>Policies</h1>
            <p className="policy-updated">Last updated: {new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
            <p className="policy-intro">
              These policies govern your use of the LifeCycle platform, covering payments, shipping, returns, and the responsibilities of both families and funeral shops.
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
