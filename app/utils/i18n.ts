import { AcceptLanguage } from "remix/headers/accept-language"

import { de } from "../i18n/de.ts"

export type Lang = "en" | "de"

export const DEFAULT_LANG: Lang = "en"

/** Languages with a generated translation file under app/i18n/. */
export const CONFIGURED_LANGUAGES: Lang[] = ["de"]

const TRANSLATIONS: Partial<Record<Lang, Record<string, string>>> = {
	de,
}

/** Parses an `Accept-Language` header and picks the best-quality supported language, defaulting to `en`. */
export function resolveLang(acceptLanguage: string | null): Lang {
	const supported: Lang[] = [DEFAULT_LANG, ...CONFIGURED_LANGUAGES]
	return (
		AcceptLanguage.from(acceptLanguage).getPreferred(supported) ?? DEFAULT_LANG
	)
}

function interpolate(
	text: string,
	params?: Record<string, string | number>,
): string {
	if (!params) return text
	return text.replace(/\{(\w+)\}/g, (match, key: string) =>
		key in params ? String(params[key]) : match,
	)
}

export type Translator = (
	template: string,
	params?: Record<string, string | number>,
) => string

/**
 * Builds a `t()` bound to `lang`, one per component render — never a shared
 * module-level "current language", so concurrent server requests for
 * different languages can't cross-contaminate each other.
 */
export function createTranslator(lang: Lang): Translator {
	const table = TRANSLATIONS[lang]
	return function t(
		template: string,
		params?: Record<string, string | number>,
	): string {
		const text =
			lang === DEFAULT_LANG ? template : (table?.[template] ?? template)
		return interpolate(text, params)
	}
}
