import './ProductRating.css'

export default function ProductRating({ rating, count }: { rating: number; count: number }) {
  const value = Number.isFinite(rating) ? Math.max(0, Math.min(5, rating)) : 0
  const label = value > 0 ? value.toFixed(1) : '0'

  return (
    <span className="product-rating" role="img" aria-label={`${label} out of 5 from ${count} ${count === 1 ? 'rating' : 'ratings'}`}>
      <span className="product-rating-stars" aria-hidden="true">
        <span>{'\u2605'.repeat(5)}</span>
        <span className="product-rating-filled" style={{ width: `${value / 5 * 100}%` }}>{'\u2605'.repeat(5)}</span>
      </span>
      <span className="product-rating-value" aria-hidden="true">{label}</span>
      <span className="product-rating-count" aria-hidden="true">({count})</span>
    </span>
  )
}
