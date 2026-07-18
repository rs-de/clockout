import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { CONFIGURED_LANGUAGES, hashKey } from "../app/utils/i18n.ts"

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
	const sources = new Map<string, string>() // hash key -> source text
	for (const file of files) {
		for (const literal of extractLiterals(readFileSync(file, "utf8"), file)) {
			sources.set(hashKey(literal), literal)
		}
	}

	for (const lang of CONFIGURED_LANGUAGES) {
		const modulePath = join(I18N_DIR, `${lang}.ts`)
		await syncLanguageFile(lang, modulePath, sources)
	}
}

async function syncLanguageFile(
	lang: string,
	modulePath: string,
	sources: Map<string, string>,
) {
	const existing = (await import(modulePath)) as {
		[key: string]: Record<string, { source: string; text: string }>
	}
	const entries = { ...existing[lang] }

	const missingKeys: string[] = []
	for (const [key, source] of sources) {
		if (!entries[key]) {
			missingKeys.push(key)
			if (!CHECK_ONLY) entries[key] = { source, text: source }
		}
	}

	if (CHECK_ONLY) {
		if (missingKeys.length > 0) {
			console.error(
				`${lang}: ${missingKeys.length} string(s) not yet synced — run \`pnpm i18n:sync\` and translate them:`,
			)
			for (const key of missingKeys) {
				console.error(`  ${key}: ${JSON.stringify(sources.get(key))}`)
			}
			process.exitCode = 1
		} else {
			const untranslated = Object.entries(entries).filter(
				([, entry]) => entry.text === entry.source,
			)
			if (untranslated.length > 0) {
				console.warn(
					`${lang}: ${untranslated.length} key(s) still match their English source — double-check these are actually translated:`,
				)
				for (const [key, entry] of untranslated) {
					console.warn(`  ${key}: ${JSON.stringify(entry.source)}`)
				}
			}
			console.log(`${lang}: all ${Object.keys(entries).length} keys synced.`)
		}
		return
	}

	const sortedKeys = Object.keys(entries).sort()
	const body = sortedKeys
		.map((key) => {
			const { source, text } = entries[key] as { source: string; text: string }
			return `\t${JSON.stringify(key)}: ${JSON.stringify({ source, text }, null, "\t").replace(/\n/g, "\n\t")},`
		})
		.join("\n")

	writeFileSync(
		modulePath,
		`import type { TranslationEntry } from "../utils/i18n.ts"\n\n` +
			`// Generated/maintained by \`pnpm i18n:sync\` — do not hand-edit keys, only \`text\`.\n` +
			`export const ${lang}: Record<string, TranslationEntry> = {\n${body}\n}\n`,
	)

	if (missingKeys.length === 0) {
		console.log(`${lang}: up to date (${sortedKeys.length} keys).`)
	} else {
		console.log(
			`${lang}: added ${missingKeys.length} new key(s), needs translating:`,
		)
		for (const key of missingKeys) {
			console.log(`  ${key}: ${JSON.stringify(entries[key]?.source)}`)
		}
	}
}

await main()
