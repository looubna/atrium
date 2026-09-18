import { collection, doc, limit, onSnapshot, orderBy, query, type DocumentData } from 'firebase/firestore'
import { useEffect, useRef, useState } from 'react'
import { firebase, firebaseConfigured } from '../firebase'

export interface LiveOptions<T> {
  /** While polling (the fallback), keep polling only as long as this holds. */
  keepPolling?: (value: T) => boolean
  pollMs?: number
  /** Changing it reads the data again (for example after an upload). */
  version?: unknown
}

type Subscribe<T> = (next: (value: T) => void, failed: () => void) => () => void

/**
 * Data the worker updates while it works. A Firestore listener (read-only and
 * owner-scoped by the security rules) delivers each change the moment it is
 * written; if listening isn't possible, the API is polled instead.
 */
function useLive<T>(
  key: string | null,
  subscribe: Subscribe<T> | null,
  fallback: () => Promise<T>,
  initial: T,
  options: LiveOptions<T>,
): T {
  const { keepPolling, pollMs = 3000, version } = options
  const [value, setValue] = useState<T>(initial)
  const latest = useRef({ subscribe, fallback, keepPolling })
  latest.current = { subscribe, fallback, keepPolling }

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let unsubscribe: (() => void) | undefined

    const poll = async () => {
      try {
        const next = await latest.current.fallback()
        if (cancelled) return
        setValue(next)
        const again = latest.current.keepPolling
        if (!again || again(next)) timer = setTimeout(() => void poll(), pollMs)
      } catch {
        if (!cancelled) timer = setTimeout(() => void poll(), pollMs * 2)
      }
    }

    const listen = latest.current.subscribe
    if (listen) {
      unsubscribe = listen(
        (next) => {
          if (!cancelled) setValue(next)
        },
        () => {
          unsubscribe?.()
          unsubscribe = undefined
          if (!cancelled) void poll()
        },
      )
    } else {
      void poll()
    }
    return () => {
      cancelled = true
      unsubscribe?.()
      if (timer) clearTimeout(timer)
    }
  }, [key, pollMs, version])

  return value
}

/** One document, live. `path` is relative to the database root, e.g. `users/{uid}/...`. */
export function useLiveDocument<T extends { id: string }>(
  path: string | null,
  fallback: () => Promise<T>,
  options: LiveOptions<T | null> = {},
): T | null {
  const subscribe: Subscribe<T | null> | null =
    path && firebaseConfigured()
      ? (next, failed) =>
          onSnapshot(
            doc(firebase().db, path),
            (snap) => next(snap.exists() ? ({ ...(snap.data() as DocumentData), id: snap.id } as T) : null),
            failed,
          )
      : null
  return useLive<T | null>(path ?? 'api', subscribe, fallback, null, options)
}

/** The newest documents of a collection, live. */
export function useLiveCollection<T>(
  path: string | null,
  shape: { orderByField: string; max: number; map: (id: string, data: DocumentData) => T },
  fallback: () => Promise<T[]>,
  options: LiveOptions<T[] | null> = {},
): T[] | null {
  const subscribe: Subscribe<T[] | null> | null =
    path && firebaseConfigured()
      ? (next, failed) =>
          onSnapshot(
            query(collection(firebase().db, path), orderBy(shape.orderByField, 'desc'), limit(shape.max)),
            (snap) => next(snap.docs.map((d) => shape.map(d.id, d.data()))),
            failed,
          )
      : null
  return useLive<T[] | null>(path ?? 'api', subscribe, fallback, null, options)
}
