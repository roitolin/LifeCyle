type RatingRow = { rating?: number | string | null }

export function summarizeProductRatings(rows: readonly RatingRow[] | null | undefined) {
  let total = 0
  let count = 0
  for (const row of rows ?? []) {
    const rating = Number(row.rating)
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) continue
    total += rating
    count += 1
  }
  return { average: count > 0 ? total / count : 0, count }
}
