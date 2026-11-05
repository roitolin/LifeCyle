import { useEffect, useRef, useState } from 'react'
import BrandLogo from '@/components/BrandLogo'
import PageBackButton from '@/components/PageBackButton'
import NotificationDropdown from '@/components/NotificationDropdown'
import './DevelopersPage.css'

type Developer = {
  name: string
  image: string
  color: string
}

const developers: Developer[] = [
  { name: 'Ezra M. Baguhin', image: '/developers/ezra-baguhin.png', color: '#ffe7ad' },
  { name: 'Jared M. Cuerbo', image: '/developers/jared-cuerbo.png', color: '#f8edf1' },
  { name: 'Daisy Y. Derial', image: '/developers/daisy-derial.png', color: '#dfe8f8' },
  { name: 'Elenne Antonette P. Garbo', image: '/developers/elenne-garbo.png', color: '#f8d9c5' },
  { name: 'Princess Mecca P. Quijano', image: '/developers/princess-quijano.png', color: '#dcefdc' },
  { name: 'Roi Veinze A. Tolin', image: '/developers/roi-tolin.png', color: '#e6dcf4' },
]

function ContactMark({ kind }: { kind: 'email' | 'phone' | 'facebook' }) {
  if (kind === 'email') {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></svg>
  }
  if (kind === 'phone') {
    return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.6 2.8 9.4 2a1.7 1.7 0 0 1 2 1l1.2 3.1a1.7 1.7 0 0 1-.4 1.8l-1.8 1.5a14.8 14.8 0 0 0 4.2 4.2l1.5-1.8a1.7 1.7 0 0 1 1.8-.4l3.1 1.2a1.7 1.7 0 0 1 1 2l-.8 2.8a2.2 2.2 0 0 1-2.3 1.6A18.8 18.8 0 0 1 3 5.1a2.2 2.2 0 0 1 1.6-2.3Z" /></svg>
  }
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07c0 6.02 4.39 11 10.13 11.93v-8.43H7.08v-3.5h3.05V9.4c0-3.03 1.79-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.96h-1.51c-1.49 0-1.95.93-1.95 1.88v2.29h3.32l-.53 3.5h-2.79V24C19.61 23.07 24 18.09 24 12.07Z" /></svg>
}

export default function DevelopersPage() {
  const trackRef = useRef<HTMLDivElement>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [selectedDeveloper, setSelectedDeveloper] = useState<Developer | null>(null)

  useEffect(() => {
    if (!selectedDeveloper) return
    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedDeveloper(null)
    }
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [selectedDeveloper])

  const updateActiveCard = () => {
    const track = trackRef.current
    if (!track) return
    const center = track.getBoundingClientRect().left + track.clientWidth / 2
    const cards = Array.from(track.querySelectorAll<HTMLElement>('.developers-card'))
    let closestIndex = 0
    let closestDistance = Number.POSITIVE_INFINITY
    cards.forEach((card, index) => {
      const rect = card.getBoundingClientRect()
      const distance = Math.abs(rect.left + rect.width / 2 - center)
      if (distance < closestDistance) {
        closestDistance = distance
        closestIndex = index
      }
    })
    setActiveIndex(currentIndex => currentIndex === closestIndex ? currentIndex : closestIndex)
  }

  const moveTo = (index: number) => {
    const cards = trackRef.current?.querySelectorAll<HTMLElement>('.developers-card')
    const target = cards?.[Math.max(0, Math.min(developers.length - 1, index))]
    target?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }

  const showUnavailableContact = (channel: string) => {
    if (!selectedDeveloper) return
    window.alert(`${selectedDeveloper.name}'s ${channel} has not been added yet.`)
  }

  return (
    <div className="developers-standalone-page">
      <header className="developers-page-header">
        <div className="developers-page-header-inner">
          <PageBackButton to="/user/about" label="Back to About" className="developers-back-button" />
          <div className="developers-header-actions">
            <NotificationDropdown variant="seller-centre" />
            <BrandLogo compact className="developers-brand" />
          </div>
        </div>
      </header>
      <main className="developers-page-main">
      <div className="developers-page-content">
        <section className="developers-intro">
          <span className="developers-eyebrow">THE LIFECYCLE TEAM</span>
          <h2>Built by people who care.</h2>
          <p>Meet the six people building the LifeCycle experience. Select a portrait to view a developer profile.</p>
          <span className="developers-swipe-hint" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h15l-3-3M20 16H5l3 3" /></svg>
            Swipe to explore
          </span>
        </section>

        <div className="developers-carousel-wrap">
          <button
            type="button"
            className="developers-arrow developers-arrow-prev"
            onClick={() => moveTo(activeIndex - 1)}
            disabled={activeIndex === 0}
            aria-label="Previous developer"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <div
            className="developers-track"
            ref={trackRef}
            onScroll={updateActiveCard}
            aria-label="LifeCycle developers"
            role="region"
            tabIndex={0}
          >
            {developers.map((developer, index) => (
              <button
                type="button"
                key={developer.name}
                className="developers-card"
                style={{ backgroundColor: developer.color }}
                onClick={() => setSelectedDeveloper(developer)}
                aria-label={`View ${developer.name}'s developer profile, ${index + 1} of ${developers.length}`}
              >
                <span className="developers-card-copy">
                  <strong>{developer.name}</strong>
                  <small>LifeCycle developer</small>
                </span>
                <img src={developer.image} alt="" loading="lazy" />
                <span className="developers-card-hint">View profile <span aria-hidden="true">↗</span></span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="developers-arrow developers-arrow-next"
            onClick={() => moveTo(activeIndex + 1)}
            disabled={activeIndex === developers.length - 1}
            aria-label="Next developer"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>

        <div className="developers-pagination" aria-live="polite">
          <span>{activeIndex + 1} / {developers.length}</span>
          <div>
            {developers.map((developer, index) => (
              <button
                key={developer.name}
                type="button"
                className={index === activeIndex ? 'is-active' : ''}
                onClick={() => moveTo(index)}
                aria-label={`Go to ${developer.name}`}
                aria-current={index === activeIndex ? 'true' : undefined}
              />
            ))}
          </div>
        </div>
      </div>

      {selectedDeveloper ? (
        <div className="developer-profile-overlay" role="dialog" aria-modal="true" aria-labelledby="developer-profile-name" onClick={() => setSelectedDeveloper(null)}>
          <section className="developer-profile-modal" onClick={event => event.stopPropagation()}>
            <img className="developer-profile-image" src={selectedDeveloper.image} alt={`${selectedDeveloper.name}, LifeCycle developer`} />
            <div className="developer-profile-shade" aria-hidden="true" />
            <button type="button" className="developer-profile-close" onClick={() => setSelectedDeveloper(null)} aria-label="Close developer profile">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12" /></svg>
            </button>
            <div className="developer-profile-content">
              <span className="developer-profile-eyebrow">LIFECYCLE DEVELOPER</span>
              <h2 id="developer-profile-name">{selectedDeveloper.name}</h2>
              <p>Part of the team designing and building the LifeCycle experience.</p>
              <h3>Contact</h3>
              <div className="developer-contact-actions">
                <button type="button" onClick={() => showUnavailableContact('Gmail')} aria-label={`Contact ${selectedDeveloper.name} through Gmail`}><span className="is-email"><ContactMark kind="email" /></span><small>Gmail</small></button>
                <button type="button" onClick={() => showUnavailableContact('phone number')} aria-label={`Call ${selectedDeveloper.name}`}><span className="is-phone"><ContactMark kind="phone" /></span><small>Phone</small></button>
                <button type="button" onClick={() => showUnavailableContact('Facebook profile')} aria-label={`Open ${selectedDeveloper.name}'s Facebook profile`}><span className="is-facebook"><ContactMark kind="facebook" /></span><small>Facebook</small></button>
              </div>
              <small className="developer-contact-note">Contact links will be connected when team details are available.</small>
            </div>
          </section>
        </div>
      ) : null}
      </main>
    </div>
  )
}
