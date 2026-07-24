import type { Handle, RemixNode } from "remix/ui"

import { routes } from "../routes.ts"
import { createTranslator, DEFAULT_LANG, type Lang } from "../utils/i18n.ts"
import { Footer } from "./footer.tsx"
import { Navbar } from "./navbar.tsx"

export interface DocumentProps {
	children?: RemixNode
	head?: RemixNode
	title?: string
	lang?: Lang
}

const DEFAULT_TITLE = readAppDisplayName("Clockout")

// Order matches the app.css tokens that depend on them (border-size,
// spacing, duration, font, z-index) — see the comment above their <link> use.
const OPEN_PROPS_FILES = [
	"borders.min.css",
	"sizes.min.css",
	"durations.min.css",
	"fonts.min.css",
	"zindex.min.css",
] as const

// iOS only synthesizes a splash screen from these explicit, per-device media
// queries — omitting them shows a blank screen on launch instead of the app
// icon. Same image for both color schemes, so no prefers-color-scheme clause
// is needed.
const APPLE_SPLASH_SCREENS: Array<{ href: string; media: string }> = [
	["2048-2732", 1024, 1366, 2],
	["1668-2388", 834, 1194, 2],
	["1536-2048", 768, 1024, 2],
	["1668-2224", 834, 1112, 2],
	["1620-2160", 810, 1080, 2],
	["1290-2796", 430, 932, 3],
	["1179-2556", 393, 852, 3],
	["1284-2778", 428, 926, 3],
	["1170-2532", 390, 844, 3],
	["1125-2436", 375, 812, 3],
	["1242-2688", 414, 896, 3],
	["828-1792", 414, 896, 2],
	["1242-2208", 414, 736, 3],
	["750-1334", 375, 667, 2],
	["640-1136", 320, 568, 2],
].map(([size, width, height, ratio]) => ({
	href: `/icons/apple-splash-dark-${size}.jpg`,
	media:
		`(device-width: ${width}px) and (device-height: ${height}px) and ` +
		`(-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait)`,
}))

export function Document(handle: Handle<DocumentProps>) {
	return () => {
		const {
			children,
			head,
			title = DEFAULT_TITLE,
			lang = DEFAULT_LANG,
		} = handle.props
		const t = createTranslator(lang)

		return (
			<html lang={lang}>
				<head>
					<meta charSet="utf-8" />
					<meta name="viewport" content="width=device-width, initial-scale=1" />
					<meta name="theme-color" content="hsl(206, 100%, 50%)" />
					<meta
						name="description"
						content={t(
							"Lean, private time tracking that shows how much time is left today and this week.",
						)}
					/>
					<link rel="manifest" href="/manifest.webmanifest" />
					<link rel="apple-touch-icon" href="/icons/apple-icon-180.png" />
					<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
					{/* apple-mobile-web-app-capable is deprecated in favor of the
					standard mobile-web-app-capable, but Safari/iOS still only
					honors the apple-prefixed one — keep both. */}
					<meta name="mobile-web-app-capable" content="yes" />
					<meta name="apple-mobile-web-app-capable" content="yes" />
					{APPLE_SPLASH_SCREENS.map(({ href, media }) => (
						<link rel="apple-touch-startup-image" href={href} media={media} />
					))}
					{/* Linked directly (not @import'd from app.css) so the browser
					discovers and fetches all five in parallel from the initial HTML
					instead of serially after fetching+parsing app.css first. Order
					matters: these must precede app.css so its :root can override them. */}
					{OPEN_PROPS_FILES.map((path) => (
						<link
							rel="stylesheet"
							href={routes.assets.href({
								path: `node_modules/open-props/${path}`,
							})}
						/>
					))}
					<link
						rel="stylesheet"
						href={routes.assets.href({ path: "app/assets/app.css" })}
					/>
					<title>{title}</title>
					{head}
				</head>
				<body>
					<div class="app-root">
						<Navbar />
						<main class="app-main">{children}</main>
						<Footer t={t} />
					</div>
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
