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
	sourceMaps: isDevelopment ? "external" : undefined,
	minify: !isDevelopment,
	watch: false,
	scripts: {
		define: {
			"process.env.NODE_ENV": JSON.stringify(nodeEnv),
			BUILD_STAMP: JSON.stringify(buildStamp),
		},
	},
})
