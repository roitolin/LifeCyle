import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

function getAdminTarget(role: string) {
  if (role === 'super_admin' || role === 'admin') return '/admin/dashboard'
  if (role === 'funeral_admin') return '/admin/funeral-shops'
  return '/admin/dashboard'
}

function AdminRoleRedirectPage() {
  const [target, setTarget] = useState('')

  useEffect(() => {
    let active = true

    const loadRole = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const user = session?.user
        if (!user) {
          if (active) setTarget('/login')
          return
        }

        const { data } = await supabase
          .from('users')
          .select('role')
          .eq('id', user.id)
          .maybeSingle()

        if (!active) return
        const role = String(data?.role || 'user').toLowerCase()
        setTarget(getAdminTarget(role))
      } catch {
        if (active) setTarget('/admin/dashboard')
      }
    }

    void loadRole()

    return () => {
      active = false
    }
  }, [])

  if (!target) {
    return <section className="panel"><p className="panel-sub">Loading admin area...</p></section>
  }

  return <Navigate to={target} replace />
}

export default AdminRoleRedirectPage
