import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import PageBackButton from '@/components/PageBackButton'
import AdminServiceRequestDetail from './AdminServiceRequestDetail'
import type { ServiceRequest } from './AdminOrdersPage'

function AdminServiceRequestDetailPage() {
  const { requestId = '' } = useParams()
  const navigate = useNavigate()
  const [request, setRequest] = useState<ServiceRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async (background = false) => {
    if (!requestId) {
      setError('No service request was selected.')
      setLoading(false)
      return
    }

    if (!background) {
      setLoading(true)
      setError('')
    }
    try {
      const { data, error: requestError } = await supabase
        .from('funeral_service_requests')
        .select('*')
        .eq('id', requestId)
        .maybeSingle()

      if (requestError) throw requestError
      if (!data) {
        setRequest(null)
        setError('This service request could not be found.')
        return
      }

      const item = data as ServiceRequest
      let requesterName = ''
      let requesterEmail = ''

      if (item.requesterId) {
        const { data: requester } = await supabase
          .from('users')
          .select('fullName, email')
          .eq('id', item.requesterId)
          .maybeSingle()
        requesterName = String(requester?.fullName || '')
        requesterEmail = String(requester?.email || '')
      }

      setRequest({ ...item, requesterName, requesterEmail })
      setError('')
    } catch {
      if (!background) {
        setRequest(null)
        setError('Unable to load this service request right now.')
      }
    } finally {
      setLoading(false)
    }
  }, [requestId])

  useEffect(() => {
    void load()
  }, [load])

  useRealtimeRefresh([{ table: 'funeral_service_requests', filter: `id=eq.${requestId}` }], () => load(true), Boolean(requestId) && !loading)

  if (loading) {
    return (
      <section className="panel admin-service-route-state">
        <div className="admin-loading-state">Loading service request...</div>
      </section>
    )
  }

  if (error || !request) {
    return (
      <section className="panel admin-service-route-state">
        <h2>Request unavailable</h2>
        <p className="panel-sub">{error || 'This service request could not be found.'}</p>
        <div className="quick-actions">
          <PageBackButton fallbackTo="/admin/orders" />
          <button type="button" className="solid-btn" onClick={() => void load()}>Try again</button>
        </div>
      </section>
    )
  }

  return <AdminServiceRequestDetail request={request} onClose={() => navigate('/admin/orders')} />
}

export default AdminServiceRequestDetailPage
