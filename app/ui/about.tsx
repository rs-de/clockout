import type { Handle } from "remix/ui"

import { EXAMPLES } from "../utils/examples.ts"
import { createTranslator, DEFAULT_LANG, type Lang } from "../utils/i18n.ts"

export interface AboutPageProps {
	lang?: Lang
}

export function AboutPage(handle: Handle<AboutPageProps>) {
	return () => {
		const t = createTranslator(handle.props.lang ?? DEFAULT_LANG)

		return (
			<div class="about-page">
				<h1>{t("About clockout")}</h1>
				<p class="about-intro">
					{t(
						"clockout is a lean, private time tracker: clock in, clock out, and see at a glance how much time is left today and this week. No account needed — your data is encrypted in your browser before it's synced, so only you can unlock it. Try one of the example scenarios below to see it in action.",
					)}
				</p>
				<h2 class="about-examples-heading">{t("Examples")}</h2>
				<ul class="about-examples">
					{EXAMPLES.map((example) => (
						<li key={example.id}>
							<a href={`/example/${example.id}`}>{t(example.title)}</a>
						</li>
					))}
				</ul>
			</div>
		)
	}
}
