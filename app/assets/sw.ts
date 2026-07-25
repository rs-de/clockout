/// <reference lib="WebWorker" />

export type {}

declare let self: ServiceWorkerGlobalScope
declare const BUILD_STAMP: string
declare const process: { env: { NODE_ENV: string } }

const IS_DEV = process.env.NODE_ENV === "development"
const CACHE = `clockout-v${BUILD_STAMP}`
const PRECACHE_URLS = ["/", "/about"]

// A page that just told the user "a new version is available" and is about
// to navigate to reload wants that one navigation to actually be fresh —
// staleWhileRevalidate would otherwise happily hand back the copy it already
// has and only pick up the new one on the *following* request. Set right
// before the deliberate reload navigation and consumed (deleted) by it.
const forceFreshUrls = new Set<string>()

self.addEventListener("install", (event) => {
	self.skipWaiting()
	// Each URL is cached individually — unlike cache.addAll(), one slow/failed
	// fetch (e.g. a cold origin) can't fail the whole install.
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) =>
				Promise.all(PRECACHE_URLS.map((url) => cache.add(url).catch(() => {}))),
			),
	)
})

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches.keys().then(async (keys) => {
			const oldKeys = keys.filter((key) => key !== CACHE)
			// An old cache existing means this activation replaced a previously
			// installed worker — a real update, not the very first install — so
			// tell open tabs a new version is available.
			const isUpdate = oldKeys.length > 0
			await Promise.all(oldKeys.map((key) => caches.delete(key)))
			await self.clients.claim()
			if (isUpdate) {
				const clients = await self.clients.matchAll({ type: "window" })
				for (const client of clients) client.postMessage({ type: "SW_UPDATED" })
			}
		}),
	)
})

self.addEventListener("message", (event) => {
	if (event.data?.type !== "CO_FORCE_FRESH") return
	forceFreshUrls.add(event.data.url as string)
})

self.addEventListener("fetch", (event) => {
	const { request } = event
	if (request.method !== "GET") return

	const url = new URL(request.url)

	// Source-map requests are devtools-internal, not something the app or a
	// user ever waits on — and re-issuing them through fetch() inside a
	// service worker has been unreliable in practice (Safari in particular),
	// synthesizing this file's own "Offline" 503 fallback for a request that
	// was never actually offline. Skip interception entirely: not calling
	// respondWith() lets the browser handle the request on its own, same as
	// if this listener didn't exist for it.
	if (url.pathname.endsWith(".map")) return

	const isStaticAsset =
		url.pathname.startsWith("/icons/") ||
		url.pathname === "/logo.svg" ||
		url.pathname === "/favicon.svg" ||
		url.pathname === "/manifest.webmanifest"

	// True browser navigations AND the client router's resolveFrame() fetch
	// (soft page transitions, requested with "accept: text/html") both want
	// cached HTML instantly while revalidating in the background.
	const wantsHtml =
		request.mode === "navigate" ||
		(request.headers.get("accept")?.includes("text/html") ?? false)

	event.respondWith(
		IS_DEV
			? networkFirst(request)
			: wantsHtml
				? staleWhileRevalidate(request)
				: isStaticAsset
					? cacheFirst(request)
					: networkFirst(request),
	)
})

async function staleWhileRevalidate(request: Request): Promise<Response> {
	const cache = await caches.open(CACHE)
	const cached = await cache.match(request)
	const fetchPromise = fetch(request)
		.then((response) => {
			if (response.ok) cache.put(request, response.clone())
			return response
		})
		.catch(() => cached ?? new Response("Offline", { status: 503 }))
	if (forceFreshUrls.delete(request.url)) return fetchPromise
	return cached ?? fetchPromise
}

async function cacheFirst(request: Request): Promise<Response> {
	const cached = await caches.match(request)
	if (cached) return cached
	const response = await fetch(request)
	if (response.ok) {
		const cache = await caches.open(CACHE)
		cache.put(request, response.clone())
	}
	return response
}

async function networkFirst(request: Request): Promise<Response> {
	const cache = await caches.open(CACHE)
	try {
		const response = await fetch(request)
		// The JS that hydrates the app lives under /assets/ — caching it here
		// (the only place non-static, non-html GETs get cached) is what keeps
		// the app usable at all once offline.
		const wantsJson = request.headers
			.get("accept")
			?.includes("application/json")
		if (response.ok && !wantsJson) cache.put(request, response.clone())
		return response
	} catch {
		return (
			(await cache.match(request)) ?? new Response("Offline", { status: 503 })
		)
	}
}
