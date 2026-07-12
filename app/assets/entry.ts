import { run } from "remix/ui"

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
