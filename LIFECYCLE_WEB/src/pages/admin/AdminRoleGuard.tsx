import { Navigate, Outlet } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type AdminRoleGuardProps = {
  allowedRoles: string[]
  redirectTo?: string
}

function AdminRoleGuard({ allowedRoles, redirectTo = '/admin/dashboard' }: AdminRoleGuardProps) {
  const [role, setRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    const resolveRole = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const user = session?.user
        if (!user) {
          if (active) {
            setRole('user')
            setLoading(false)
          }
          return
        }

        const { data } = await supabase
          .from('users')
          .select('role')
          .eq('id', user.id)
          .maybeSingle()

        if (!active) return
        const normalizedRole = String(data?.role || 'user').toLowerCase().trim()
        setRole(normalizedRole)
      } catch {
        if (active) setRole('user')
      } finally {
        if (active) setLoading(false)
      }
    }

    void resolveRole()

    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      void resolveRole()
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  if (loading) {
    return (
      <section className="panel">
        <p className="panel-sub">Checking permissions...</p>
      </section>
    )
  }

  if (!role || !allowedRoles.includes(role)) {
    return <Navigate to={redirectTo} replace />
  }

  return <Outlet />
}

export default AdminRoleGuard
