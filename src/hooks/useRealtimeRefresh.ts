import { useCallback, useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { supabase } from '@/services/supabaseClient'

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
  useFocusEffect(useCallback(() => {
    if (!subscriptionKey) return
    const tables = JSON.parse(subscriptionKey) as RealtimeSource[]
    const channel = supabase.channel(`app-refresh-${++nextChannelId}`)
    let closed = false
    let running = false
    let pending = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const isVisible = () => AppState.currentState !== 'background' && AppState.currentState !== 'inactive'
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
    const foreground = AppState.addEventListener('change', status => {
      if (status === 'active') scheduleRefresh()
    })

    return () => {
      closed = true
      if (timer) clearTimeout(timer)
      foreground.remove()
      void supabase.removeChannel(channel)
    }
  }, [subscriptionKey]))
}
