import ProfileLayout from './ProfileLayout'
import { Link } from 'react-router-dom'

const sections = [
  {
    title: 'What LifeCycle does',
    description: 'LifeCycle lets families browse active funeral shops, review available products, send service requests, submit payment receipts, and follow request updates in one place.',
  },
  {
    title: 'How shops participate',
    description: 'Funeral providers register a shop and submit it for review. Approved shops manage their own listings, contact information, payment instructions, schedules, and service requests.',
  },
  {
    title: 'What families should verify',
    description: 'Before submitting a request or payment, review the selected shop, prices, availability, service details, and payment instructions. Contact the shop when an arrangement needs confirmation.',
  },
]

export default function AboutPage() {
  return (
    <ProfileLayout title="About LifeCycle" subtitle="How the platform connects families and funeral service providers.">
      <div className="about-content">
        <section className="about-intro">
          <h2>Funeral service coordination in one place</h2>
          <p>LifeCycle is a marketplace and request-management platform for funeral services in the Philippines.</p>
        </section>

        <div className="about-sections">
          {sections.map(section => (
            <section key={section.title} className="about-section">
              <h3>{section.title}</h3>
              <p>{section.description}</p>
            </section>
          ))}
        </div>

        <section className="about-team-card" aria-labelledby="about-team-title">
          <div className="about-team-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="8" r="3" />
              <path d="M3.5 19c.6-3 2.5-4.5 5.5-4.5s4.9 1.5 5.5 4.5M16 11.5a2.5 2.5 0 1 0-1.5-4.5M16 15c2.4 0 3.9 1.1 4.5 3.2" />
            </svg>
          </div>
          <div className="about-team-copy">
            <h2 id="about-team-title">Meet the team</h2>
            <p>Get to know the six people building the LifeCycle experience.</p>
          </div>
          <Link to="/user/developers" className="about-team-link">
            View our developers
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </Link>
        </section>
      </div>
    </ProfileLayout>
  )
}
