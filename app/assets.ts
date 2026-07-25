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

/**
 * The style compiler (lightningcss, under the hood) emits a literal
 * `"sourceRoot": null` in generated .css.map files instead of omitting the
 * key. Per the source map spec sourceRoot must be a string or absent —
 * Chrome silently ignores the null, but Safari logs "invalid sourceRoot"
 * for it. Strip it so the map is spec-compliant everywhere.
 *
 * Every branch below returns a *new* Response, never the original: reading
 * a Response's body (`.text()`, `.json()`, ...) permanently consumes its
 * stream, so returning the same `response` object afterward — even
 * unchanged — hands the caller an already-disturbed stream. That crashed
 * every non-CSS .map request (JS/TS maps have no `sourceRoot` at all, so
 * this always hit the "return response" branch, since fixed) with
 * `ERR_INVALID_STATE: ReadableStream is locked` deep in the server's own
 * response-sending code — surfacing to the browser as a bare failed
 * request (dev-only: this whole helper is a no-op in production).
 */
async function fixSourceMapResponse(response: Response): Promise<Response> {
	const text = await response.text()
	const init = {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	}

	let body: unknown
	try {
		body = JSON.parse(text)
	} catch {
		return new Response(text, init)
	}
	if (
		!body ||
		typeof body !== "object" ||
		(body as { sourceRoot?: unknown }).sourceRoot !== null
	) {
		return new Response(text, init)
	}
	const { sourceRoot: _sourceRoot, ...rest } = body as { sourceRoot: null }
	return new Response(JSON.stringify(rest), init)
}

export async function fetchAsset(request: Request): Promise<Response | null> {
	const response = await assetServer.fetch(request)
	if (!response) return null
	if (!new URL(request.url).pathname.endsWith(".map")) return response
	return fixSourceMapResponse(response)
}
