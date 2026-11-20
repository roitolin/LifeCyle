import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'

type RealtimeSource = { table: string; filter?: string; includeDeletes?: boolean }

let nextChannelId = 0
const CHANGE_EVENTS = ['INSERT', 'UPDATE'] as const
const REFRESH_DELAY_MS = 160

/**
 * Use changes as invalidations so the existing scoped query stays the source of truth.
 * A single trailing refresh catches changes received while a query is still running.
 */
export function useRealtimeRefresh(
  sources: RealtimeSource[],
  refresh: () => void | Promise<unknown>,
  enabled = true,
) {
  const refreshRef = useRef(refresh)
  useEffect(() => {
    refreshRef.current = refresh
  }, [refresh])

  const subscriptionKey = enabled && sources.length ? JSON.stringify(sources) : ''
  useEffect(() => {
    if (!subscriptionKey) return
    const tables = JSON.parse(subscriptionKey) as RealtimeSource[]
    const channel = supabase.channel(`app-refresh-${++nextChannelId}`)
    let closed = false
    let running = false
    let pending = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const isVisible = () => document.visibilityState !== 'hidden'
    const scheduleRefresh = () => {
      if (closed || timer || !isVisible()) return
      if (running) {
        pending = true
        return
      }
      timer = setTimeout(() => {
        timer = undefined
        if (closed || !isVisible()) return
        running = true
        void Promise.resolve()
          .then(() => { if (!closed) return refreshRef.current() })
          .catch(() => { /* The active screen handles read errors. */ })
          .finally(() => {
            running = false
            if (pending) {
              pending = false
              scheduleRefresh()
            }
          })
      }, REFRESH_DELAY_MS)
    }

    for (const { table, filter, includeDeletes } of tables) {
      for (const event of includeDeletes ? [...CHANGE_EVENTS, 'DELETE'] as const : CHANGE_EVENTS) {
        channel.on('postgres_changes', { event, schema: 'public', table, filter, select: ['id'] }, scheduleRefresh)
      }
    }
    channel.subscribe(status => {
      if (status === 'SUBSCRIBED') scheduleRefresh()
    })
    window.addEventListener('focus', scheduleRefresh)
    document.addEventListener('visibilitychange', scheduleRefresh)

    return () => {
      closed = true
      if (timer) clearTimeout(timer)
      window.removeEventListener('focus', scheduleRefresh)
      document.removeEventListener('visibilitychange', scheduleRefresh)
      void supabase.removeChannel(channel)
    }
  }, [subscriptionKey])
}
