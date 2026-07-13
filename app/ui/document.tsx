import type { Handle, RemixNode } from "remix/ui"

import { routes } from "../routes.ts"

export interface DocumentProps {
	children?: RemixNode
	head?: RemixNode
	title?: string
}

const DEFAULT_TITLE = readAppDisplayName("Clockout")

export function Document(handle: Handle<DocumentProps>) {
	return () => {
		const { children, head, title = DEFAULT_TITLE } = handle.props

		return (
			<html lang="en">
				<head>
					<meta charSet="utf-8" />
					<meta name="viewport" content="width=device-width, initial-scale=1" />
					<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
					<link
						rel="stylesheet"
						href={routes.assets.href({ path: "app/assets/app.css" })}
					/>
					<title>{title}</title>
					{head}
				</head>
				<body>
					{children}
					<footer>
						<a href="/about">About clockout</a>
					</footer>
					<script
						type="module"
						src={routes.assets.href({ path: "app/assets/entry.ts" })}
					></script>
				</body>
			</html>
		)
	}
}

function readAppDisplayName(value: string): string {
	return value.startsWith("%%") ? "Remix App" : decodeURIComponent(value)
}
