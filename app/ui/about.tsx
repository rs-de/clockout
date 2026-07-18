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
			<div>
				<h1>{t("About clockout")}</h1>
				<ul>
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
