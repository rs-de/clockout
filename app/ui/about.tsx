import type { Handle } from "remix/ui"

import { EXAMPLES } from "../utils/examples.ts"

export function AboutPage(_handle: Handle) {
	return () => (
		<div>
			<h1>About clockout</h1>
			<ul>
				{EXAMPLES.map((example) => (
					<li key={example.id}>
						<a href={`/example/${example.id}`}>{example.title}</a>
					</li>
				))}
			</ul>
		</div>
	)
}
