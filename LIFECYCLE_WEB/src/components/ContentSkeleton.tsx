import type { ReactNode } from 'react'
import './ContentSkeleton.css'

export function SkeletonRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="lc-skeleton">
      <span className="sr-only" role="status">{label}</span>
      <div className="lc-skeleton-preview" aria-hidden="true" inert>{children}</div>
    </div>
  )
}

export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <span className={`lc-skeleton-block ${className}`} />
}

export function ProductGridSkeleton({ storefront = false }: { storefront?: boolean }) {
  return (
    <SkeletonRegion label="Loading products">
      <div className={storefront ? 'shop-detail-grid' : 'sp-grid'}>
        {Array.from({ length: 6 }, (_, index) => (
          <article className={storefront ? 'shop-product-card' : 'sp-card'} key={index}>
            <div className={storefront ? 'shop-product-image-empty' : 'sp-card-img-wrap'}>
              <SkeletonBlock className="lc-skeleton-fill" />
            </div>
            <div className={storefront ? 'shop-product-copy' : 'sp-card-body'}>
              <div className={storefront ? 'lc-shop-title-skeleton' : 'sp-card-name'}>
                <SkeletonBlock className="lc-skeleton-name" />
              </div>
              {storefront ? (
                <div className="lc-skeleton-copy">
                  <SkeletonBlock className="lc-skeleton-price" />
                  <SkeletonBlock className="lc-skeleton-meta" />
                  <SkeletonBlock className="lc-skeleton-rating" />
                </div>
              ) : (
                <>
                  <div className="sp-card-price-row"><SkeletonBlock className="lc-skeleton-price" /></div>
                  <div className="sp-card-meta"><SkeletonBlock className="lc-skeleton-meta" /><SkeletonBlock className="lc-skeleton-tag" /></div>
                  <div className="sp-card-shop"><SkeletonBlock className="lc-skeleton-short" /></div>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
    </SkeletonRegion>
  )
}

export function ProductDetailSkeleton() {
  return (
    <SkeletonRegion label="Loading product">
      <div className="pd-main-card">
        <div className="pd-gallery-section">
          <div className="pd-main-image"><SkeletonBlock className="lc-skeleton-fill" /></div>
          <div className="pd-thumbs">
            {[0, 1, 2].map(index => <div key={index} className="pd-thumb"><SkeletonBlock className="lc-skeleton-fill" /></div>)}
          </div>
          <div className="pd-social-share"><SkeletonBlock className="lc-skeleton-control" /><SkeletonBlock className="lc-skeleton-control" /></div>
        </div>
        <div className="pd-info-section">
          <div className="pd-title"><SkeletonBlock className="lc-skeleton-heading" /></div>
          <div className="pd-listing-shop"><SkeletonBlock className="pd-skeleton-shop" /></div>
          <div className="pd-meta"><SkeletonBlock className="lc-skeleton-meta" /><SkeletonBlock className="lc-skeleton-tag" /></div>
          <div className="pd-price-block">
            <SkeletonBlock className="lc-skeleton-meta" />
            <SkeletonBlock className="pd-skeleton-price" />
          </div>
          <div className="pd-option-row"><SkeletonBlock className="lc-skeleton-meta" /><SkeletonBlock className="lc-skeleton-short" /></div>
          <div className="pd-actions-row"><SkeletonBlock className="lc-skeleton-action" /><SkeletonBlock className="lc-skeleton-action" /></div>
        </div>
      </div>
    </SkeletonRegion>
  )
}

export function StorefrontSkeleton() {
  return (
    <SkeletonRegion label="Loading shop">
      <section className="shop-detail-overview" id="shop-overview">
        <div className="shop-detail-summary">
          <div className="shop-detail-profile">
            <SkeletonBlock className="shop-detail-avatar" />
            <div className="shop-detail-identity lc-skeleton-copy">
              <SkeletonBlock className="lc-skeleton-heading" /><SkeletonBlock className="lc-skeleton-short" /><SkeletonBlock />
            </div>
          </div>
          <div className="shop-detail-actions">
            <SkeletonBlock className="lc-skeleton-control" /><SkeletonBlock className="lc-skeleton-control" /><SkeletonBlock className="lc-skeleton-control" />
          </div>
        </div>
        <dl className="shop-detail-facts">
          {[0, 1, 2].map(index => <div key={index}><dt><SkeletonBlock className="lc-skeleton-short" /></dt><dd><SkeletonBlock className="lc-skeleton-price" /></dd></div>)}
        </dl>
      </section>
    </SkeletonRegion>
  )
}

export function RecordListSkeleton({ kind }: { kind: 'payment' | 'request' }) {
  const payment = kind === 'payment'
  return (
    <SkeletonRegion label={payment ? 'Loading payment history' : 'Loading service requests'}>
      <div className={payment ? 'payments-list' : 'lc-skeleton-record-list'}>
        {[0, 1, 2].map(index => payment ? (
          <article key={index} className="payment-history-card">
            <div className="payment-history-head">
              <div className="payment-history-title lc-skeleton-copy"><SkeletonBlock className="lc-skeleton-name" /><SkeletonBlock className="lc-skeleton-short" /></div>
              <SkeletonBlock className="lc-skeleton-tag" />
            </div>
            <div className="payment-history-amount"><SkeletonBlock className="lc-skeleton-meta" /><SkeletonBlock className="lc-skeleton-price" /></div>
            <div className="lc-skeleton-detail-row"><SkeletonBlock className="lc-skeleton-meta" /><SkeletonBlock className="lc-skeleton-meta" /></div>
          </article>
        ) : (
          <article key={index} className="requests-card">
            <div className="requests-card-header">
              <div className="requests-card-product lc-skeleton-copy">
                <SkeletonBlock className="requests-product-thumb" />
                <div className="lc-skeleton-copy"><SkeletonBlock className="lc-skeleton-name" /><SkeletonBlock className="lc-skeleton-short" /></div>
              </div>
              <SkeletonBlock className="lc-skeleton-tag" />
            </div>
            <div className="requests-card-meta"><SkeletonBlock className="lc-skeleton-short" /><SkeletonBlock className="lc-skeleton-meta" /></div>
            <SkeletonBlock className="lc-skeleton-control" />
          </article>
        ))}
      </div>
    </SkeletonRegion>
  )
}

export function FeedbackSkeleton({ showRatingPicker = false }: { showRatingPicker?: boolean } = {}) {
  return (
    <SkeletonRegion label="Loading feedback">
      <div className="fb-board-columns">
        <div className="fb-board-feed">
          <div className="fb-feed-toolbar">
            <div className="fb-feed-heading"><h3>Feedback posts</h3><SkeletonBlock className="lc-skeleton-meta" /></div>
            <div className="fb-feed-search"><SkeletonBlock className="fb-skeleton-search" /><SkeletonBlock className="lc-skeleton-control" /></div>
            <div className="fb-feed-filters">
              {[0, 1, 2].map(index => <SkeletonBlock className="lc-skeleton-control" key={index} />)}
            </div>
          </div>
          {[0, 1].map(index => (
            <div className="fb-post-card" key={index}>
              <div className="fb-post-header">
                <div className="fb-post-author">
                  <SkeletonBlock className="fb-profile-avatar" />
                  <SkeletonBlock className="lc-skeleton-meta" />
                </div>
                <SkeletonBlock className="lc-skeleton-meta" />
              </div>
              <div className="fb-post-text lc-skeleton-copy">
                <SkeletonBlock /><SkeletonBlock className="lc-skeleton-name" />
              </div>
              <div className="fb-post-actions">
                <SkeletonBlock className="lc-skeleton-meta" /><SkeletonBlock className="lc-skeleton-meta" />
              </div>
            </div>
          ))}
        </div>
        <div className="fb-board-tools">
          <div className="fb-section">
            <h3>App ratings</h3>
            <SkeletonBlock className="lc-skeleton-meta" />
            <ul className="fb-rating-breakdown">
              {[5, 4, 3, 2, 1].map(stars => (
                <li key={stars}>
                  <SkeletonBlock className="fb-skeleton-rating-label" />
                  <SkeletonBlock className="fb-rating-track" />
                  <SkeletonBlock className="fb-skeleton-rating-count" />
                </li>
              ))}
            </ul>
          </div>
          {showRatingPicker && (
            <div className="fb-section lc-skeleton-copy">
              <h3>Your app rating</h3>
              <div className="fb-stars-picker lc-skeleton-stars">
                {[1, 2, 3, 4, 5].map(star => <SkeletonBlock key={star} />)}
              </div>
              <SkeletonBlock className="lc-skeleton-control" />
            </div>
          )}
          <div className="fb-section lc-skeleton-copy">
            <h3>Post feedback</h3>
            <SkeletonBlock className="lc-skeleton-textarea" />
            <SkeletonBlock className="lc-skeleton-control" />
          </div>
        </div>
      </div>
    </SkeletonRegion>
  )
}

export function DashboardSkeleton({ kind }: { kind: 'analytics' | 'admin' | 'seller' | 'report' }) {
  if (kind === 'analytics') return (
    <SkeletonRegion label="Loading analytics">
      <div className="lc-analytics-skeleton">
        <div className="analytics-kpis">
          {[0, 1, 2, 3].map(index => <article key={index}><MetricSkeleton /></article>)}
        </div>
        <div className="analytics-grid analytics-grid-main">
          <article className="analytics-card analytics-trend-card">
            <div className="analytics-card-head">
              <h3>User and request trend</h3>
              <div className="analytics-legend">
                <span><i className="users" />New users</span>
                <span><i className="requests" />Service requests</span>
              </div>
            </div>
            <div className="analytics-chart">
              <div className="analytics-chart-layout">
                <div className="analytics-y-axis">
                  {[0, 1, 2, 3].map(index => <SkeletonBlock key={index} />)}
                </div>
                <div className="analytics-chart-main">
                  <div className="lc-skeleton-chart-grid" />
                  <div className="analytics-axis-labels lc-skeleton-ticks">
                    {[0, 1, 2, 3, 4, 5].map(index => <SkeletonBlock key={index} />)}
                  </div>
                </div>
              </div>
              <div className="analytics-chart-summary">
                {[0, 1, 2].map(index => <SkeletonBlock className="lc-skeleton-tag" key={index} />)}
              </div>
            </div>
          </article>
          <article className="analytics-card analytics-status-card">
            <div className="analytics-card-head"><h3>Request outcomes</h3></div>
            <AnalyticsDonutSkeleton />
          </article>
        </div>
        <div className="analytics-grid analytics-grid-bottom">
          <article className="analytics-card">
            <div className="analytics-card-head"><h3>Top shops by requests</h3></div>
            <div className="analytics-table-wrap">
              <table className="analytics-table">
                <thead><tr><th>Shop</th><th>Requests</th><th>Completed</th><th>Paid value</th></tr></thead>
                <tbody>
                  {[0, 1, 2].map(row => <tr key={row}>
                    {[0, 1, 2, 3].map(column => <td key={column}><SkeletonBlock /></td>)}
                  </tr>)}
                </tbody>
              </table>
            </div>
          </article>
          <article className="analytics-card">
            <div className="analytics-card-head"><h3>Shop application status</h3></div>
            <AnalyticsDonutSkeleton compact />
          </article>
          <article className="analytics-card">
            <div className="analytics-card-head"><h3>Payments</h3></div>
            <dl className="analytics-finance-list">
              <div><dt>Paid service value</dt><dd><SkeletonBlock className="lc-skeleton-price" /></dd></div>
              <div><dt>Verified shop fees</dt><dd><SkeletonBlock className="lc-skeleton-price" /></dd></div>
            </dl>
          </article>
        </div>
      </div>
    </SkeletonRegion>
  )
  if (kind === 'admin') return (
    <SkeletonRegion label="Loading platform totals">
      <div className="dashboard-metrics">
        {[0, 1, 2, 3, 4].map(index => <article className="dashboard-metric" key={index}><MetricSkeleton /></article>)}
      </div>
    </SkeletonRegion>
  )
  if (kind === 'report') return (
    <SkeletonRegion label="Loading shop reports">
      <div className="sc-ops-page">
        <div className="sc-section-head"><h2>Reports</h2><SkeletonBlock className="lc-skeleton-control" /></div>
        <div className="sc-report-grid">
          {[0, 1, 2, 3, 4, 5].map(index => <article key={index}><MetricSkeleton /></article>)}
        </div>
        <div className="sc-report-panel">
          <div className="sc-card-header"><h3>Cases received - last 6 months</h3></div>
          <div className="sc-simple-chart">
            {[0, 1, 2, 3, 4, 5].map(index => (
              <div className="sc-chart-column" key={index}>
                <SkeletonBlock className="lc-skeleton-meta" /><div className="sc-chart-track" /><SkeletonBlock className="lc-skeleton-tag" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </SkeletonRegion>
  )
  return (
    <SkeletonRegion label="Loading your shop centre">
      <div className="sc-dashboard-overview">
        <div className="sc-dashboard-hero">
          <div className="sc-dashboard-hero-main">
            <SkeletonBlock className="sc-dashboard-hero-avatar-placeholder" />
            <div className="sc-dashboard-hero-details lc-skeleton-copy"><SkeletonBlock className="lc-skeleton-heading" /><SkeletonBlock className="lc-skeleton-short" /></div>
          </div>
        </div>
        <div className="sc-dashboard-kpis">
          {[0, 1, 2, 3].map(index => <article key={index} className="sc-kpi-card"><MetricSkeleton /></article>)}
        </div>
        <section className="sc-dashboard-panel sc-analytics-panel">
          <div className="sc-panel-header sc-performance-header">
            <div>
              <h2 className="sc-panel-title">Performance</h2>
              <p className="sc-panel-description">Requests and verified revenue for the last six months.</p>
            </div>
          </div>
          <div className="sc-chart-dual-grid">
            {['Requests', 'Revenue'].map(title => (
              <article className="sc-chart-card" key={title}>
                <div className="sc-chart-card-header"><span className="sc-chart-card-title">{title}</span></div>
                <div className="lc-skeleton-chart-grid" />
              </article>
            ))}
          </div>
        </section>
      </div>
    </SkeletonRegion>
  )
}

function AnalyticsDonutSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'analytics-donut-layout compact' : 'analytics-donut-layout'}>
      <span className="analytics-donut lc-skeleton-ring" />
      <div className="analytics-pie-legend">
        {[0, 1, 2].map(index => (
          <div key={index}>
            <span className="lc-skeleton-legend-dot" />
            <SkeletonBlock />
            <SkeletonBlock className="lc-skeleton-legend-count" />
            <SkeletonBlock className="lc-skeleton-legend-share" />
          </div>
        ))}
      </div>
    </div>
  )
}

function MetricSkeleton() {
  return (
    <div className="lc-skeleton-copy">
      <SkeletonBlock className="lc-skeleton-meta" />
      <SkeletonBlock className="lc-skeleton-heading lc-skeleton-short" />
      <SkeletonBlock className="lc-skeleton-meta" />
    </div>
  )
}
