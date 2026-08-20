import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import {
  markWebAccountSessionSignedOut,
  recordWebAccountLoginActivity,
} from '@/utils/accountActivity'

export default function LogoutPage() {
  const navigate = useNavigate()

  useEffect(() => {
    const logout = async () => {
      await markWebAccountSessionSignedOut()
      await recordWebAccountLoginActivity('logout')
      await supabase.auth.signOut({ scope: 'local' })
      navigate('/funeral', { replace: true })
    }

    void logout()
  }, [navigate])

  return (
    <main className="auth-page">
      <div className="auth-layout">
        <section className="auth-card">
          <h1>Logging out...</h1>
        </section>
      </div>
    </main>
  )
}
