import ProfileLayout from './ProfileLayout'

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
      </div>
    </ProfileLayout>
  )
}
