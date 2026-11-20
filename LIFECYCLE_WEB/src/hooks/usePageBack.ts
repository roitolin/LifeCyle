import { useNavigate } from 'react-router-dom'

export function usePageBack(fallbackTo = '/funeral') {
  const navigate = useNavigate()

  return () => {
    // BrowserRouter starts its own history index at zero on a direct entry.
    const index = window.history.state?.idx
    if (typeof index === 'number' && index > 0) {
      navigate(-1)
      return
    }

    navigate(fallbackTo, { replace: true })
  }
}
