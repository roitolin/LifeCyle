import { APP_ICON_TRANSPARENT_URL } from '@/assets/appIconAssets'

function AuthBrandPanel() {
  return (
    <section className='auth-brand' aria-hidden='true'>
      <div className='auth-brand-inner'>
        <img className='auth-logo' src={APP_ICON_TRANSPARENT_URL} alt='LifeCycle' />
        <h2>LifeCycle</h2>
        <p className='auth-brand-tagline'>Browse funeral shops and coordinate service requests.</p>
        <ul className='auth-brand-list'>
          <li>
            <svg className='auth-check' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.4' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12' /></svg>
            <span>Active funeral shop listings</span>
          </li>
          <li>
            <svg className='auth-check' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.4' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12' /></svg>
            <span>Service and custom tribute requests</span>
          </li>
          <li>
            <svg className='auth-check' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.4' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12' /></svg>
            <span>Shop payment instructions and receipt review</span>
          </li>
        </ul>
      </div>
    </section>
  )
}

export default AuthBrandPanel
