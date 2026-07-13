import { createController } from "remix/router"

import { assetServer } from "../assets.ts"
import { routes } from "../routes.ts"
import { AboutPage } from "../ui/about.tsx"
import { App } from "../ui/app.tsx"
import { Document } from "../ui/document.tsx"

export default createController(routes, {
	actions: {
		async assets(context) {
			return (
				(await assetServer.fetch(context.request)) ??
				new Response("Not Found", { status: 404 })
			)
		},
		home(context) {
			return context.render(
				<Document>
					<App />
				</Document>,
			)
		},
		doc(context) {
			return context.render(
				<Document>
					<App />
				</Document>,
			)
		},
		example(context) {
			return context.render(
				<Document>
					<App />
				</Document>,
			)
		},
		about(context) {
			return context.render(
				<Document title="About — clockout">
					<AboutPage />
				</Document>,
			)
		},
	},
})
