import type { Handle } from "remix/ui"

import { EXAMPLES } from "../utils/examples.ts"

export function AboutPage(_handle: Handle) {
	return () => (
		<div>
			<h1>About clockout</h1>
			<p>
				A lean time-tracking app: start and stop tracking your work, and always
				see how much time is left for the day and the week.
			</p>

			<h2>Try an example</h2>
			<p>
				These load throwaway demo data into this page only — nothing is saved or
				synced.
			</p>
			<ul>
				{EXAMPLES.map((example) => (
					<li key={example.id}>
						<a href={`/example/${example.id}`}>{example.title}</a> —{" "}
						{example.description}
					</li>
				))}
			</ul>
		</div>
	)
}
