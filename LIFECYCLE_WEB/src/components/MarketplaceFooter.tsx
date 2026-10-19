import { Link } from 'react-router-dom'
import { PAYMENT_LOGOS } from '@/assets/paymentLogoAssets'
import './MarketplaceFooter.css'

export default function MarketplaceFooter() {
  return (
    <footer className="sp-footer marketplace-footer">
      <div className="sp-footer-top">
        <div>
          <h4>CUSTOMER SERVICE</h4>
          <Link to="/user/help">Help Centre</Link>
          <a href="#payment">Payment Methods</a>
          <a href="#guarantee">LifeCycle Guarantee</a>
          <Link to="/user/contact">Contact Us</Link>
        </div>
        <div>
          <h4>ABOUT LIFECYCLE</h4>
          <Link to="/user/about">About Us</Link>
          <a href="#careers">Careers</a>
          <Link to="/policies">Policies</Link>
          <Link to="/privacy-policy">Privacy Policy</Link>
          <Link to="/seller">Shop Center</Link>
        </div>
        <div>
          <h4>PAYMENT</h4>
          <div className="sp-footer-badges">
            <img className="sp-payment-logo" src={PAYMENT_LOGOS.gcash} alt="GCash" loading="lazy" />
            <img className="sp-payment-logo" src={PAYMENT_LOGOS.maya} alt="Maya" loading="lazy" />
            <img className="sp-payment-logo" src={PAYMENT_LOGOS.visa} alt="Visa" loading="lazy" />
            <img className="sp-payment-logo" src={PAYMENT_LOGOS.landbank} alt="Landbank" loading="lazy" />
          </div>
        </div>
        <div>
          <h4>FOLLOW US</h4>
          <a href="#fb">Facebook</a>
          <a href="#ig">Instagram</a>
          <a href="#yt">YouTube</a>
        </div>
      </div>
      <div className="sp-footer-bottom">
        <span>(c) {new Date().getFullYear()} LifeCycle Funeral Services Philippines. All Rights Reserved.</span>
      </div>
    </footer>
  )
}
