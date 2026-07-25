import { run } from "remix/ui"

import { createTranslator, DEFAULT_LANG, type Lang } from "../utils/i18n.ts"

declare const BUILD_STAMP: string

// Set server-side on <html lang> (see document.tsx) and already parsed by
// the time this module runs, since the script tag sits at the end of <body>.
const t = createTranslator(
	(document.documentElement.lang as Lang) || DEFAULT_LANG,
)

run({
	async loadModule(moduleUrl, exportName) {
		const mod = await import(moduleUrl)
		return mod[exportName]
	},
	async resolveFrame(src, signal) {
		const response = await fetch(src, {
			headers: { Accept: "text/html" },
			signal,
		})
		if (!response.ok) {
			return `<pre>Frame error: ${response.status} ${response.statusText}</pre>`
		}

		if (response.body) return response.body
		return await response.text()
	},
})

if ("serviceWorker" in navigator) {
	// A per-deploy query string forces the browser's own update-check fetch
	// of /sw.js to be a genuinely new URL each time, instead of one it might
	// have a stale cached copy of.
	navigator.serviceWorker.register(`/sw.js?v=${BUILD_STAMP}`, {
		type: "module",
	})
}

// ── Update / install banners ────────────────────────────────────────────
// Both features share one small fixed-position stack instead of a full
// toast/queue component — each is at most one notice at a time, and this
// keeps them from visually overlapping if they ever did coincide.

function bannerStack(): HTMLElement {
	let stack = document.getElementById("co-banners")
	if (!stack) {
		stack = document.createElement("div")
		stack.id = "co-banners"
		stack.className = "co-banners"
		document.body.append(stack)
	}
	return stack
}

function showBanner(
	id: string,
	message: string,
	options?: {
		actionLabel?: string
		onAction?: () => void
		durationMs?: number
	},
): void {
	if (document.getElementById(id)) return
	const el = document.createElement("div")
	el.id = id
	el.className = "co-banner"
	el.setAttribute("role", "status")
	const span = document.createElement("span")
	span.textContent = message
	el.append(span)
	if (options?.actionLabel && options.onAction) {
		const onAction = options.onAction
		const btn = document.createElement("button")
		btn.type = "button"
		btn.textContent = options.actionLabel
		btn.addEventListener("click", onAction)
		el.append(btn)
	}
	bannerStack().append(el)
	if (options?.durationMs) setTimeout(() => el.remove(), options.durationMs)
}

function showUpdateBanner(): void {
	showBanner("co-update-banner", t("New version available"), {
		actionLabel: t("Refresh"),
		onAction: () => {
			// Tells the active worker this one navigation must skip its
			// stale-while-revalidate cache — see sw.ts's forceFreshUrls.
			navigator.serviceWorker?.controller?.postMessage({
				type: "CO_FORCE_FRESH",
				url: window.location.href,
			})
			window.location.assign(window.location.href)
		},
	})
}

if ("serviceWorker" in navigator) {
	navigator.serviceWorker.addEventListener("message", (event) => {
		if (event.data?.type === "SW_UPDATED") showUpdateBanner()
	})
}

// Fallback for the rare tab that never gets the SW message above — e.g. it
// was already open before the new worker activated. Same banner, driven by
// polling the server's own version instead.
const VERSION_KEY = "co-version"
let knownVersion: string | null = localStorage.getItem(VERSION_KEY)

async function checkVersion(): Promise<void> {
	try {
		const response = await fetch("/api/version")
		if (!response.ok) return
		const { version } = (await response.json()) as { version: string }
		if (knownVersion === null) {
			knownVersion = version
			localStorage.setItem(VERSION_KEY, version)
		} else if (knownVersion !== version) {
			localStorage.setItem(VERSION_KEY, version)
			showUpdateBanner()
		}
	} catch {
		// Offline — the next visibilitychange check tries again.
	}
}

void checkVersion()
document.addEventListener("visibilitychange", () => {
	if (document.visibilityState === "visible") void checkVersion()
})

// ── Add to Home Screen hint ─────────────────────────────────────────────
// Shown at most once per browser. iOS has no install-prompt API at all, so
// it gets a one-time instruction instead; Chrome-family browsers fire their
// own native prompt — deferred and re-triggered from our button so it comes
// with a "why" instead of appearing unannounced.

interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<void>
}

// Only on an actual tracked document (/d/:id) — the setup/unlock forms
// navigate away for real now (see handleSetupSubmit/handleUnlockSubmit in
// app.tsx), so a banner shown there gets torn down before it's ever
// noticed. Nothing worth installing exists before that point anyway.
const hasDocument = /^\/d\//.test(window.location.pathname)

if (hasDocument && !localStorage.getItem("co-install-prompted")) {
	const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
	const isStandalone =
		(navigator as Navigator & { standalone?: boolean }).standalone === true ||
		window.matchMedia("(display-mode: standalone)").matches

	if (!isStandalone) {
		if (isIOS) {
			localStorage.setItem("co-install-prompted", "1")
			showBanner(
				"co-install-banner",
				t('Tap Share ⬆ then "Add to Home Screen"'),
				{ durationMs: 8000 },
			)
		} else {
			window.addEventListener(
				"beforeinstallprompt",
				(event) => {
					event.preventDefault()
					localStorage.setItem("co-install-prompted", "1")
					showBanner(
						"co-install-banner",
						t("Add to your homescreen for quick access"),
						{
							actionLabel: t("Install"),
							onAction: () => {
								document.getElementById("co-install-banner")?.remove()
								void (event as BeforeInstallPromptEvent).prompt()
							},
						},
					)
				},
				{ once: true },
			)
		}
	}
}
