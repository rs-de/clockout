import { createAssetServer } from "remix/assets"

const rootDir = process.cwd()
const nodeEnv = process.env.NODE_ENV ?? "development"
const isDevelopment = nodeEnv === "development"

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
})
