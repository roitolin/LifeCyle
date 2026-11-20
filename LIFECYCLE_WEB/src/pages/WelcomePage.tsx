import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { ENV_APP_DOWNLOAD_URL, fetchPublicAppDownloadUrl, normalizeAppDownloadUrl } from '@/utils/appDownloadLink'
import { APP_ICON_TRANSPARENT_URL } from '@/assets/appIconAssets'
import desktopWelcomingBg from '@/Welcoming/desktop_welcoming.webp'
import mobileWelcomingBg from '@/Welcoming/mobile_welcomingwebp.webp'
import installOurAppMockup from '@/Welcoming/install-app.webp'
import './WelcomePage.css'

function preloadMarketplace() {
  void import('./FuneralLandingPage').catch(() => undefined)
}

function preloadShopDirectory() {
  void import('./FuneralShopsPage').catch(() => undefined)
}

function BrowseArrowIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  )
}

function DownloadAppIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  )
}

function CheckBadgeIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

export default function WelcomePage() {
  const [installNoticeVisible, setInstallNoticeVisible] = useState(false)
  const [appDownloadUrl, setAppDownloadUrl] = useState(() => normalizeAppDownloadUrl(ENV_APP_DOWNLOAD_URL))

  const loadAppDownloadUrl = useCallback(async () => {
    const resolvedUrl = await fetchPublicAppDownloadUrl()
    setAppDownloadUrl(resolvedUrl)
    if (resolvedUrl) setInstallNoticeVisible(false)
  }, [])

  useEffect(() => {
    let active = true
    void fetchPublicAppDownloadUrl().then((resolvedUrl) => {
      if (!active) return
      setAppDownloadUrl(resolvedUrl)
      if (resolvedUrl) setInstallNoticeVisible(false)
    })

    const channel = supabase
      .channel(`web-public-app-download-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_download_settings' }, () => {
        if (active) void loadAppDownloadUrl()
      })
      .subscribe()

    return () => {
      active = false
      void supabase.removeChannel(channel)
    }
  }, [loadAppDownloadUrl])

  return (
    <div className="welcome-page">
      {/* ── Section 1: Serene Welcoming Hero ── */}
      <section className="welcome-hero-section" aria-labelledby="welcome-heading">
        <picture className="welcome-bg-media" aria-hidden="true">
          <source media="(max-width: 768px)" srcSet={mobileWelcomingBg} />
          <img
            src={desktopWelcomingBg}
            alt=""
            className="welcome-bg-img"
            decoding="async"
            fetchPriority="high"
          />
        </picture>
        <div className="welcome-bottom-feather" aria-hidden="true" />

        <div className="welcome-main">
          <div className="welcome-hero">
            <div className="welcome-eyebrow">
              <img src={APP_ICON_TRANSPARENT_URL} alt="" className="welcome-eyebrow-icon" aria-hidden="true" />
              <span>Welcome to LifeCycle</span>
            </div>

            <h1 id="welcome-heading" className="welcome-title">
              Compassionate Funeral Care, All in One Place
            </h1>

            <p className="welcome-subtitle">
              Connect with verified funeral homes across the Philippines, explore transparent service
              options at your own pace, and coordinate arrangements with calm clarity.
            </p>

            <div className="welcome-cta-group">
              <Link to="/funeral" className="welcome-browse-btn" onPointerEnter={preloadMarketplace} onFocus={preloadMarketplace}>
                <span>Browse Now</span>
                <BrowseArrowIcon />
              </Link>

              <Link to="/funeral/shops" className="welcome-secondary-link" onPointerEnter={preloadShopDirectory} onFocus={preloadShopDirectory}>
                Explore verified funeral shops
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 2: Install Our App ── */}
      <section id="install-app" className="welcome-install-section" aria-labelledby="install-app-heading">
        <div className="welcome-install-inner">
          <div className="welcome-install-copy">
            <div className="welcome-install-intro">
              <span className="welcome-install-kicker">LifeCycle Mobile App</span>
              <h2 id="install-app-heading" className="welcome-install-title">
                Install Our App
              </h2>
              <p className="welcome-install-desc">
                Keep every service update, shop conversation, and payment receipt within easy reach on
                your phone—crafted for calm, reliable coordination wherever your family is.
              </p>

              <ul className="welcome-install-highlights">
                <li>
                  <span className="welcome-install-check"><CheckBadgeIcon /></span>
                  <span>Instant notifications for request &amp; payment updates</span>
                </li>
                <li>
                  <span className="welcome-install-check"><CheckBadgeIcon /></span>
                  <span>Direct messaging with verified funeral service shops</span>
                </li>
                <li>
                  <span className="welcome-install-check"><CheckBadgeIcon /></span>
                  <span>Easy receipt uploads and arrangement tracking on mobile</span>
                </li>
              </ul>
            </div>

            <div className="welcome-install-cta">
              <div className="welcome-install-actions">
                {appDownloadUrl ? (
                  <a
                    href={appDownloadUrl}
                    className="welcome-install-btn"
                    rel="noopener noreferrer"
                  >
                    <DownloadAppIcon />
                    <span>Install Our App</span>
                  </a>
                ) : (
                  <button
                    type="button"
                    className="welcome-install-btn"
                    onClick={() => setInstallNoticeVisible(visible => !visible)}
                    aria-expanded={installNoticeVisible}
                  >
                    <DownloadAppIcon />
                    <span>Install Our App</span>
                  </button>
                )}

                <Link to="/funeral" className="welcome-install-web-link">
                  Continue on web
                </Link>
              </div>

              {!appDownloadUrl && installNoticeVisible ? (
                <p className="welcome-install-note" role="status">
                  The mobile app download package will be linked here soon. You can use all LifeCycle
                  services directly in your browser anytime.
                </p>
              ) : null}
            </div>
          </div>

          <div className="welcome-install-visual">
            <div className="welcome-install-stage">
              <div className="welcome-install-aura" aria-hidden="true" />
              <div className="welcome-install-figure">
                <img
                  src={installOurAppMockup}
                  alt="Hand holding a phone displaying the LifeCycle mobile app home screen with available caskets and verified funeral shops"
                  className="welcome-install-mockup"
                  width={1243}
                  height={1266}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                />
              </div>
            </div>
          </div>
        </div>

        <footer className="welcome-footnote">
          <span>LifeCycle Funeral Services Philippines</span>
          <span className="welcome-footnote-dot" aria-hidden="true">&middot;</span>
          <Link to="/policies">Policies</Link>
          <span className="welcome-footnote-dot" aria-hidden="true">&middot;</span>
          <Link to="/privacy-policy">Privacy Policy</Link>
        </footer>
      </section>
    </div>
  )
}
