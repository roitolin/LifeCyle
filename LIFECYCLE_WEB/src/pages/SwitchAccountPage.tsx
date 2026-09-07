import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import {
  markWebAccountSessionSignedOut,
  recordWebAccountLoginActivity,
} from '@/utils/accountActivity'

export default function SwitchAccountPage() {
  const navigate = useNavigate()

  useEffect(() => {
    const switchAccount = async () => {
      await markWebAccountSessionSignedOut()
      await recordWebAccountLoginActivity('logout')
      await supabase.auth.signOut({ scope: 'local' })
      navigate('/login?switch=1', { replace: true })
    }

    void switchAccount()
  }, [navigate])

  return (
    <main className="auth-page">
      <div className="auth-layout">
        <section className="auth-card">
          <h1>Switching account...</h1>
        </section>
      </div>
    </main>
  )
}
