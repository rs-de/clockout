/// <reference lib="WebWorker" />

export type {}

declare let self: ServiceWorkerGlobalScope
declare const BUILD_STAMP: string
declare const process: { env: { NODE_ENV: string } }

const IS_DEV = process.env.NODE_ENV === "development"
const CACHE = `clockout-v${BUILD_STAMP}`
const PRECACHE_URLS = ["/", "/about"]

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
			await Promise.all(
				keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
			)
			await self.clients.claim()
		}),
	)
})

self.addEventListener("fetch", (event) => {
	const { request } = event
	if (request.method !== "GET") return

	const url = new URL(request.url)

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
