import { defineConfig } from "@playwright/test"

export default defineConfig({
	testDir: "./tests",
	use: {
		baseURL: "http://localhost:44100",
	},
	webServer: {
		command: "node --import remix/node-tsx server.ts",
		url: "http://localhost:44100",
		reuseExistingServer: !process.env.CI,
		timeout: 30_000,
	},
})
