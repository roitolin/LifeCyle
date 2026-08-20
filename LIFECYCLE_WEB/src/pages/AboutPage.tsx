import { useState } from 'react'
import ProfileLayout from './ProfileLayout'

/* Same data as mobile AboutUsScreen */
const highlights = [
  { value: '24/7', label: 'Family Support' },
  { value: 'Fast', label: 'Shop Access' },
  { value: 'Safe', label: 'Verified Process' },
]

const sections = [
  {
    title: 'LifeCycle',
    icon: '🎗️',
    description: 'LifeCycle helps families find funeral providers, review service options, and coordinate arrangements with clearer communication.',
  },
  {
    title: 'Why We Built This',
    icon: '📢',
    description: 'Families often need to make difficult arrangements quickly. LifeCycle gives them one dedicated place to compare funeral shops, send service details, and track responses.',
  },
  {
    title: 'Our Mission',
    icon: '❤️',
    description: 'We help families coordinate funeral services with trusted providers while keeping important details organized and accessible.',
  },
  {
    title: 'Our Vision',
    icon: '✨',
    description: 'A compassionate service network where families can find reliable funeral support when they need it most.',
  },
]

const systemMembers = [
  { name: 'Member 1', role: 'Team Member', quote: 'Compassion matters most when families are carrying loss. LifeCycle is built to make support easier to reach.' },
  { name: 'Member 2', role: 'Team Member', quote: 'Every clear update gives families time, direction, and a little more space to focus on remembrance.' },
  { name: 'Member 3', role: 'Team Member', quote: 'Compassion becomes powerful when it moves quickly. LifeCycle helps communities respond when every minute matters.' },
  { name: 'Member 4', role: 'Team Member', quote: 'One organized service path can reduce confusion and help families move through difficult decisions.' },
  { name: 'Member 5', role: 'Team Member', quote: 'When service providers and families communicate clearly, arrangements become more manageable.' },
  { name: 'Member 6', role: 'Team Member', quote: 'Technology should serve humanity. LifeCycle is built to make help visible, reachable, and immediate for those in need.' },
]

export default function AboutPage() {
  const [activeMember, setActiveMember] = useState<typeof systemMembers[0] | null>(null)

  return (
    <ProfileLayout title="About Us" subtitle="Learn more about LifeCycle and the team behind it.">
      <div className="about-content">
        {/* Hero Banner */}
        <div className="about-hero">
          <span className="about-badge">Community Powered</span>
          <h2 className="about-hero-title">About LifeCycle</h2>
          <p className="about-hero-subtitle">
            We are building a calmer, more human way to connect families with funeral service providers.
          </p>
          <div className="about-highlights">
            {highlights.map(h => (
              <div key={h.label} className="about-highlight-card">
                <div className="about-highlight-value">{h.value}</div>
                <div className="about-highlight-label">{h.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Info Sections */}
        {sections.map(s => (
          <div key={s.title} className="about-card">
            <div className="about-card-header">
              <span className="about-card-icon">{s.icon}</span>
              <h3>{s.title}</h3>
            </div>
            <p>{s.description}</p>
          </div>
        ))}

        {/* Team Members */}
        <div className="about-card about-members-card">
          <div className="about-card-header">
            <span className="about-card-icon">👥</span>
            <h3>System Members</h3>
          </div>
          <span className="about-member-count">{systemMembers.length} Members</span>
          <p className="about-member-subtitle">Core team behind LifeCycle. Click a member to view details.</p>
          <div className="about-member-grid">
            {systemMembers.map(m => (
              <button key={m.name} className="about-member-card" onClick={() => setActiveMember(m)}>
                <div className="about-member-avatar">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-7 8-7s8 3 8 7"/></svg>
                </div>
                <div className="about-member-name">{m.name}</div>
                <div className="about-member-role">{m.role}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Member Modal */}
        {activeMember && (
          <div className="about-modal-overlay" onClick={() => setActiveMember(null)}>
            <div className="about-modal" onClick={e => e.stopPropagation()}>
              <button className="about-modal-close" onClick={() => setActiveMember(null)}>✕</button>
              <div className="about-modal-avatar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-7 8-7s8 3 8 7"/></svg>
              </div>
              <h3 className="about-modal-name">{activeMember.name}</h3>
              <span className="about-modal-role">{activeMember.role}</span>
              <blockquote className="about-modal-quote">"{activeMember.quote}"</blockquote>
            </div>
          </div>
        )}
      </div>
    </ProfileLayout>
  )
}
