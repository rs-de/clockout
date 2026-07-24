import { spawn } from "node:child_process"
import lighthouse from "lighthouse"
import { chromium } from "playwright"

const PORT = 9_222
const BASE_URL = process.argv[2] ?? "http://localhost:44100"

// One representative URL per distinct screen — the example route stands in
// for the tracking screen, which can't be reached fresh without local state.
const PAGES: Array<{ name: string; path: string }> = [
	{ name: "Home (setup)", path: "/" },
	{ name: "About", path: "/about" },
	{ name: "Tracking (example)", path: "/example/steady-week" },
]

const CATEGORIES = [
	"performance",
	"accessibility",
	"best-practices",
	"seo",
] as const

const THRESHOLDS: Record<string, number> = {
	performance: 80,
	accessibility: 90,
	"best-practices": 90,
	seo: 90,
}

async function isServerUp(): Promise<boolean> {
	try {
		await fetch(BASE_URL, { signal: AbortSignal.timeout(1000) })
		return true
	} catch {
		return false
	}
}

async function waitForServer(ms = 10_000): Promise<void> {
	const deadline = Date.now() + ms
	while (Date.now() < deadline) {
		if (await isServerUp()) return
		await new Promise((r) => setTimeout(r, 300))
	}
	throw new Error(`Server not ready at ${BASE_URL} after ${ms}ms`)
}

let serverProcess: ReturnType<typeof spawn> | null = null

if (!(await isServerUp())) {
	serverProcess = spawn("node", ["--import", "remix/node-tsx", "server.ts"], {
		stdio: "ignore",
		env: { ...process.env, NODE_ENV: "production" },
	})
	await waitForServer()
}

const browser = await chromium.launch({
	args: [`--remote-debugging-port=${PORT}`, "--headless=new"],
})

let anyFailed = false

try {
	for (const page of PAGES) {
		const url = `${BASE_URL}${page.path}`
		const result = await lighthouse(url, {
			port: PORT,
			output: "json",
			logLevel: "error",
			onlyCategories: [...CATEGORIES],
		})

		if (!result) {
			console.error(`Lighthouse returned no result for ${url}`)
			anyFailed = true
			continue
		}

		const { categories, audits } = result.lhr

		console.log(`\nLighthouse — ${page.name} (${page.path})\n`)

		const failures: string[] = []
		for (const cat of Object.values(categories)) {
			const score = Math.round((cat.score ?? 0) * 100)
			const threshold = THRESHOLDS[cat.id] ?? 0
			const pass = score >= threshold
			const icon = pass ? "✓" : "✗"
			console.log(
				`  ${icon}  ${cat.title.padEnd(20)} ${score}  (min ${threshold})`,
			)
			if (!pass) failures.push(`${cat.title}: ${score} < ${threshold}`)
		}

		const failed = Object.values(audits)
			.filter((a) => a.score !== null && a.score < 1)
			.sort((a, b) => (a.score ?? 0) - (b.score ?? 0))

		if (failed.length) {
			console.log("\nIssues:\n")
			for (const a of failed) {
				const score = String(Math.round((a.score ?? 0) * 100)).padStart(3)
				console.log(`  [${score}]  ${a.title}`)
				if (a.displayValue) console.log(`         ${a.displayValue}`)
			}
		}

		if (failures.length) {
			console.log(
				`\nFailed thresholds for ${page.name}:\n${failures.map((f) => `  • ${f}`).join("\n")}\n`,
			)
			anyFailed = true
		}
	}
} finally {
	await browser.close()
	serverProcess?.kill()
}

if (anyFailed) process.exit(1)

console.log()
