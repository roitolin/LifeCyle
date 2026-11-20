import { useEffect, useState } from 'react'

const CACHE_TTL_MS = 30_000

export function createMarketplaceResource<T>(fetchData: () => Promise<{ data: T; expiresAt: number }>) {
  let cached: { viewerId: string | null; data: T; expiresAt: number } | undefined
  let pending: { viewerId: string | null; promise: Promise<T> } | undefined

  const read = (viewerId: string | null) =>
    cached?.viewerId === viewerId && cached.expiresAt > Date.now() ? cached.data : undefined

  const load = (viewerId: string | null): Promise<T> => {
    const data = read(viewerId)
    if (data !== undefined) return Promise.resolve(data)
    if (pending?.viewerId === viewerId) return pending.promise

    const promise = fetchData().then(result => {
      if (pending?.promise === promise) {
        cached = {
          viewerId,
          data: result.data,
          expiresAt: Math.min(result.expiresAt, Date.now() + CACHE_TTL_MS),
        }
      }
      return result.data
    }).finally(() => {
      if (pending?.promise === promise) pending = undefined
    })

    pending = { viewerId, promise }
    return promise
  }

  return { read, load }
}

export function earliestShopExpiry(dates: (string | null | undefined)[]) {
  return dates.reduce((earliest, date) => {
    const expiresAt = date ? Date.parse(date) : Number.POSITIVE_INFINITY
    return Number.isNaN(expiresAt) ? earliest : Math.min(earliest, expiresAt)
  }, Number.POSITIVE_INFINITY)
}

type ResourceResult<T> = { viewerId: string | null; data?: T; error?: string }

export function useMarketplaceResource<T>(
  resource: ReturnType<typeof createMarketplaceResource<T>>,
  viewerId: string | null,
  fallbackError: string,
) {
  const [result, setResult] = useState<ResourceResult<T>>()

  useEffect(() => {
    let active = true
    void resource.load(viewerId).then(data => {
      if (active) setResult({ viewerId, data })
    }, (error: unknown) => {
      if (!active) return
      const message = error && typeof error === 'object' && 'message' in error ? error.message : null
      setResult({ viewerId, error: typeof message === 'string' ? message : fallbackError })
    })
    return () => { active = false }
  }, [resource, viewerId, fallbackError])

  const current = result?.viewerId === viewerId ? result : undefined
  const data = current?.data ?? resource.read(viewerId)
  return { data, error: current?.error, loading: !current && data === undefined }
}
