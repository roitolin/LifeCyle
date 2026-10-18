import BrandLogo from '@/components/BrandLogo'
import PageBackButton from '@/components/PageBackButton'
import AccountMobileHeader from '@/components/AccountMobileHeader'
import './FuneralLandingPage.css'

const sections = [
  {
    title: '1. Service requests',
    body: 'A checkout submission creates a service request for the selected funeral shop. Review the shop, items, quantities, service details, and contact information before submitting. The shop may contact you to confirm arrangements.',
  },
  {
    title: '2. Payment verification',
    body: 'When payment is required, use the secure online checkout shown in LifeCycle. A payment is confirmed after the payment provider verifies the transaction.',
  },
  {
    title: '3. Service fulfilment',
    body: 'The funeral shop is responsible for confirming schedules, availability, collection or delivery arrangements, and any other fulfilment details. Check My Service Requests for status updates and use the provided contact details when coordination is needed.',
  },
  {
    title: '4. Cancellations',
    body: 'Cancellation availability depends on the request status and work already completed by the funeral shop. Contact the shop or LifeCycle Support as soon as possible if plans change.',
  },
  {
    title: '5. Shop information',
    body: 'LifeCycle displays shops that currently meet the platform\'s publication requirements. Families should still review each shop\'s listing, contact details, availability, prices, and instructions before sending a request or payment.',
  },
  {
    title: '6. Seller Policies',
    body: 'Funeral shops must keep their listings, prices, stock levels, payment instructions, schedules, and contact details accurate. Sellers are expected to review requests and communicate clearly with families. Repeated violations may result in restricted or suspended shop access.',
  },
  {
    title: '7. Acceptable Use',
    body: 'Users must not upload illegal, fraudulent, or harmful content, or misuse the platform for purposes other than coordinating funeral services. We may suspend accounts that violate these terms.',
  },
  {
    title: '8. Contact Us',
    body: 'For questions about these policies or a service request, use the Contact Support page while signed in.',
  },
]

export default function PoliciesPage() {
  return (
    <div className="sp-page policy-page">
      <AccountMobileHeader />
      <header className="sp-header">
        <div className="sp-header-inner policy-header-inner">
          <BrandLogo />
        </div>
      </header>

      <div className="sp-body">
        <div className="sp-body-inner policy-body-inner">
          <div className="page-back-row"><PageBackButton to="/funeral" label="Back to home" /></div>
          <div className="policy-content">
            <span className="policy-kicker">LifeCycle Funeral Services Philippines</span>
            <h1>Policies</h1>
            <p className="policy-updated">Last updated: {new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
            <p className="policy-intro">
              These policies explain how service requests, payment verification, fulfilment, and account use work on LifeCycle.
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
