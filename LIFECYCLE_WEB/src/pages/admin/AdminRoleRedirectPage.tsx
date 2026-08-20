import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { doc, getDoc } from '@/lib/supabaseDbCompat'
import { auth, db } from '@/lib/supabaseAuth'

function getAdminTarget(role: string) {
  if (role === 'super_admin') return '/admin/dashboard'
  if (role === 'funeral_admin') return '/admin/funeral-shops'
  return '/admin/dashboard'
}

function AdminRoleRedirectPage() {
  const [target, setTarget] = useState('')

  useEffect(() => {
    const loadRole = async () => {
      const currentUser = auth.currentUser
      if (!currentUser) {
        setTarget('/')
        return
      }

      try {
        const snapshot = await getDoc(doc(db, 'users', currentUser.uid))
        const role = String(snapshot.data()?.role || 'user').toLowerCase()
        setTarget(getAdminTarget(role))
      } catch {
        setTarget('/admin/dashboard')
      }
    }

    void loadRole()
  }, [])

  if (!target) {
    return <section className="panel"><p className="panel-sub">Loading admin area...</p></section>
  }

  return <Navigate to={target} replace />
}

export default AdminRoleRedirectPage

