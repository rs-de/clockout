import { createController } from "remix/router"

import { assetServer } from "../assets.ts"
import { routes } from "../routes.ts"
import { AboutPage } from "../ui/about.tsx"
import { App } from "../ui/app.tsx"
import { Document } from "../ui/document.tsx"
import { resolveLang } from "../utils/i18n.ts"

export default createController(routes, {
	actions: {
		async assets(context) {
			return (
				(await assetServer.fetch(context.request)) ??
				new Response("Not Found", { status: 404 })
			)
		},
		home(context) {
			const lang = resolveLang(context.request.headers.get("accept-language"))
			return context.render(
				<Document lang={lang}>
					<App lang={lang} />
				</Document>,
			)
		},
		doc(context) {
			const lang = resolveLang(context.request.headers.get("accept-language"))
			return context.render(
				<Document lang={lang}>
					<App lang={lang} />
				</Document>,
			)
		},
		example(context) {
			const lang = resolveLang(context.request.headers.get("accept-language"))
			return context.render(
				<Document lang={lang}>
					<App lang={lang} />
				</Document>,
			)
		},
		about(context) {
			const lang = resolveLang(context.request.headers.get("accept-language"))
			return context.render(
				<Document title="About — clockout" lang={lang}>
					<AboutPage lang={lang} />
				</Document>,
			)
		},
	},
})
