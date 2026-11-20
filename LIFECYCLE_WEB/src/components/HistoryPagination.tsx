type HistoryPaginationProps = {
  label: string
  page: number
  pageCount: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}

export default function HistoryPagination({
  label, page, pageCount, pageSize, onPageChange, onPageSizeChange,
}: HistoryPaginationProps) {
  return (
    <nav className="sc-history-pagination" aria-label={label}>
      <button
        type="button"
        className="sc-history-page-arrow"
        disabled={page <= 1}
        aria-label="Previous page"
        onClick={() => onPageChange(page - 1)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
      </button>
      <span className="sc-history-page-num is-active" aria-current="page" aria-live="polite">{page}</span>
      <button
        type="button"
        className="sc-history-page-arrow"
        disabled={page >= pageCount}
        aria-label="Next page"
        onClick={() => onPageChange(page + 1)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
      </button>
      <label className="sc-history-page-size">
        <select
          value={pageSize}
          aria-label="Rows per page"
          onChange={event => {
            onPageSizeChange(Number(event.target.value))
            onPageChange(1)
          }}
        >
          <option value={10}>10 /Page</option>
          <option value={20}>20 /Page</option>
          <option value={50}>50 /Page</option>
        </select>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </label>
    </nav>
  )
}
