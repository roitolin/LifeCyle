import { Link } from 'react-router-dom'
import { PAYMENT_LOGOS } from '@/assets/paymentLogoAssets'
import './MarketplaceFooter.css'

export default function MarketplaceFooter({ compact = false }: { compact?: boolean } = {}) {
  return (
    <footer className={compact ? 'marketplace-footer marketplace-footer-compact' : 'marketplace-footer'}>
      {!compact && <div className="marketplace-footer__sections">
        <div>
          <h4>Customer service</h4>
          <Link to="/user/help">Help Centre</Link>
          <Link to="/user/contact">Contact support</Link>
        </div>
        <div>
          <h4>About LifeCycle</h4>
          <Link to="/user/about">About us</Link>
          <Link to="/policies">Platform policies</Link>
          <Link to="/privacy-policy">Privacy policy</Link>
          <Link to="/seller">Shop Center</Link>
        </div>
        <div className="marketplace-footer__payments">
          <h4>Payment methods</h4>
          <div className="marketplace-footer__badges">
            <img src={PAYMENT_LOGOS.gcash} alt="GCash" loading="lazy" />
            <img src={PAYMENT_LOGOS.maya} alt="Maya" loading="lazy" />
            <img src={PAYMENT_LOGOS.visa} alt="Visa" loading="lazy" />
            <img src={PAYMENT_LOGOS.landbank} alt="Landbank" loading="lazy" />
          </div>
        </div>
      </div>}
      <div className="marketplace-footer__bottom">
        <span>© {new Date().getFullYear()} LifeCycle Funeral Services Philippines</span>
        {compact && (
          <nav aria-label="Legal">
            <Link to="/policies">Platform policies</Link>
            <Link to="/privacy-policy">Privacy policy</Link>
          </nav>
        )}
      </div>
    </footer>
  )
}
