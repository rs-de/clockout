import { run } from "remix/ui"

declare const BUILD_STAMP: string

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
