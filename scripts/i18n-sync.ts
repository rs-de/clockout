import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { EXAMPLES } from "../app/utils/examples.ts"
import { CONFIGURED_LANGUAGES } from "../app/utils/i18n.ts"

const APP_DIR = new URL("../app/", import.meta.url).pathname
const I18N_DIR = join(APP_DIR, "i18n")
const CHECK_ONLY = process.argv.includes("--check")

// Matches `t(` followed by a string or template literal — the same
// convention `createTranslator`'s `t()` relies on: the template must always
// be a literal, never built at runtime, or it can't be found here.
const T_CALL_PATTERN = /\bt\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g

function listSourceFiles(dir: string): string[] {
	const files: string[] = []
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name)
		if (entry.isDirectory()) {
			if (path === I18N_DIR) continue
			files.push(...listSourceFiles(path))
		} else if (/\.(ts|tsx)$/.test(entry.name)) {
			files.push(path)
		}
	}
	return files
}

function extractLiterals(source: string, file: string): string[] {
	const literals: string[] = []
	for (const match of source.matchAll(T_CALL_PATTERN)) {
		const raw = match[0].slice("t(".length).trim()
		if (raw.includes("${")) {
			console.warn(
				`${file}: skipping a t() call with a dynamic template literal — the text must be a plain string literal.`,
			)
			continue
		}
		// The matched literal is valid JS source (same quoting/escaping rules
		// as the file it came from), so evaluating it is the simplest correct
		// unescape — this only ever runs against our own trusted repo source.
		literals.push(new Function(`return (${raw})`)() as string)
	}
	return literals
}

async function main() {
	const files = listSourceFiles(APP_DIR)
	const sources = new Set<string>()
	for (const file of files) {
		for (const literal of extractLiterals(readFileSync(file, "utf8"), file)) {
			sources.add(literal)
		}
	}

	// EXAMPLES' titles are rendered via `t(example.title)` — a dynamic call
	// site, since the value comes from data, not a literal — so the generic
	// t(...) scan above can't find them. They're still translatable text, so
	// pull them in directly from their one source of truth.
	for (const example of EXAMPLES) {
		sources.add(example.title)
	}

	for (const lang of CONFIGURED_LANGUAGES) {
		const modulePath = join(I18N_DIR, `${lang}.ts`)
		await syncLanguageFile(lang, modulePath, sources)
	}
}

async function syncLanguageFile(
	lang: string,
	modulePath: string,
	sources: Set<string>,
) {
	const existing = (await import(modulePath)) as {
		[key: string]: Record<string, string>
	}
	const entries = { ...existing[lang] }

	const missingKeys: string[] = []
	for (const source of sources) {
		if (!(source in entries)) {
			missingKeys.push(source)
			if (!CHECK_ONLY) entries[source] = source
		}
	}

	// A key whose source text no longer appears anywhere in the app is dead
	// weight — it can only get here if the `t()` call (or EXAMPLES title) that
	// introduced it was since deleted or reworded.
	const staleKeys = Object.keys(entries).filter((key) => !sources.has(key))

	if (CHECK_ONLY) {
		let ok = true
		if (missingKeys.length > 0) {
			console.error(
				`${lang}: ${missingKeys.length} string(s) not yet synced — run \`pnpm i18n:sync\` and translate them:`,
			)
			for (const key of missingKeys) {
				console.error(`  ${JSON.stringify(key)}`)
			}
			ok = false
		}
		if (staleKeys.length > 0) {
			console.error(
				`${lang}: ${staleKeys.length} key(s) no longer used in source — run \`pnpm i18n:sync\` to remove them:`,
			)
			for (const key of staleKeys) {
				console.error(`  ${JSON.stringify(key)}`)
			}
			ok = false
		}
		if (!ok) {
			process.exitCode = 1
		} else {
			const untranslated = Object.entries(entries).filter(
				([key, text]) => text === key,
			)
			if (untranslated.length > 0) {
				console.warn(
					`${lang}: ${untranslated.length} key(s) still match their English source — double-check these are actually translated:`,
				)
				for (const [key] of untranslated) {
					console.warn(`  ${JSON.stringify(key)}`)
				}
			}
			console.log(`${lang}: all ${Object.keys(entries).length} keys synced.`)
		}
		return
	}

	for (const key of staleKeys) delete entries[key]

	const sortedKeys = Object.keys(entries).sort()
	const body = sortedKeys
		.map((key) => `\t${JSON.stringify(key)}: ${JSON.stringify(entries[key])},`)
		.join("\n")

	writeFileSync(
		modulePath,
		`// Generated/maintained by \`pnpm i18n:sync\` — do not hand-edit keys, only values.\n` +
			`export const ${lang}: Record<string, string> = {\n${body}\n}\n`,
	)

	if (missingKeys.length === 0 && staleKeys.length === 0) {
		console.log(`${lang}: up to date (${sortedKeys.length} keys).`)
		return
	}
	if (missingKeys.length > 0) {
		console.log(
			`${lang}: added ${missingKeys.length} new key(s), needs translating:`,
		)
		for (const key of missingKeys) {
			console.log(`  ${JSON.stringify(key)}`)
		}
	}
	if (staleKeys.length > 0) {
		console.log(`${lang}: removed ${staleKeys.length} unused key(s):`)
		for (const key of staleKeys) {
			console.log(`  ${JSON.stringify(key)}`)
		}
	}
}

await main()
