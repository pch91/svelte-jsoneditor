/// <reference types="@sveltejs/kit" />
import { build, files, version } from '$service-worker'

const CACHE_NAME = `jsoneditor-pwa-cache-${version}`

// All files to pre-cache (built JS/CSS + static assets)
const ASSETS_TO_CACHE = [...build, ...files]

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))
      .then(() => (self as unknown as ServiceWorkerGlobalScope).skipWaiting())
  )
})

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => (self as unknown as ServiceWorkerGlobalScope).clients.claim())
  )
})

self.addEventListener('fetch', (event: FetchEvent) => {
  const { request } = event
  const url = new URL(request.url)

  // Only handle GET requests and http/https schemes
  if (request.method !== 'GET' || !url.protocol.startsWith('http')) {
    return
  }

  // Handle navigation requests (SPA support and offline fallback)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 200) {
            const copy = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
          }
          return response
        })
        .catch(async () => {
          // Fallback to cached version of the requested URL, or the root/404 page
          const cache = await caches.open(CACHE_NAME)
          const cachedResponse = await cache.match(request)
          if (cachedResponse) {
            return cachedResponse
          }

          // Fallback to offline index or 404 page
          const fallback =
            (await cache.match('./')) ||
            (await cache.match('./404.html')) ||
            (await cache.match('/svelte-jsoneditor/')) ||
            (await cache.match('/svelte-jsoneditor/404.html'))
          return (
            fallback ||
            new Response('Offline - Svelte JSON Editor', {
              headers: { 'Content-Type': 'text/html' }
            })
          )
        })
    )
    return
  }

  // Static assets (build & files): cache-first strategy
  if (ASSETS_TO_CACHE.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse
        }
        return fetch(request).then((response) => {
          if (response.status === 200) {
            const copy = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
          }
          return response
        })
      })
    )
    return
  }

  // Other GET requests: stale-while-revalidate / network-first
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse.status === 200) {
            const copy = networkResponse.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
          }
          return networkResponse
        })
        .catch(() => cachedResponse)

      return cachedResponse || fetchPromise
    })
  )
})
