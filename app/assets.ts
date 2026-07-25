import { execSync } from "node:child_process"

import { createAssetServer } from "remix/assets"

const rootDir = process.cwd()
const nodeEnv = process.env.NODE_ENV ?? "development"
const isDevelopment = nodeEnv === "development"

function getBuildStamp(): string {
	try {
		return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim()
	} catch {
		return "unknown"
	}
}

// Versions the service worker's cache name (see app/assets/sw.ts) so every
// deploy gets a fresh cache without a human remembering to bump a constant.
export const buildStamp = getBuildStamp()

export const assetServer = createAssetServer({
	basePath: "/assets",
	rootDir,
	fileMap: {
		"app/*path": "app/*path",
		"node_modules/*path": "node_modules/*path",
	},
	allow: [
		"app/assets/**",
		"app/i18n/**",
		"app/ui/**",
		"app/utils/**",
		"node_modules/**",
	],
	deny: ["app/**/*.server.*"],
	// No bundling here — every source file is served individually, compiled
	// but unminified in dev (comments and structure intact, just import
	// specifiers rewritten and TS types/JSX stripped), so a source map buys
	// little: devtools already point at something close to the original.
	// Not worth it against what it's cost so far — a Safari-only
	// "sourceRoot": null warning, then an outright server crash
	// (ERR_INVALID_STATE: ReadableStream is locked) from working around
	// that, both rooted in the asset compiler's own (pre-1.0 beta) map
	// generation, not something under app control. Already off in
	// production; this turns it off in dev too.
	minify: !isDevelopment,
	// Off in prod: fingerprinting assumes files on disk won't change (see
	// README). On in dev, or edits like this one never take effect without
	// a server restart.
	watch: isDevelopment,
	scripts: {
		define: {
			"process.env.NODE_ENV": JSON.stringify(nodeEnv),
			BUILD_STAMP: JSON.stringify(buildStamp),
		},
	},
})
