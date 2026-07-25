import { createController } from "remix/router"

import { fetchAsset } from "../assets.ts"
import { routes } from "../routes.ts"
import { AboutPage } from "../ui/about.tsx"
import { App } from "../ui/app.tsx"
import { Document } from "../ui/document.tsx"
import { createTranslator, resolveLang } from "../utils/i18n.ts"

export default createController(routes, {
	actions: {
		async assets(context) {
			return (
				(await fetchAsset(context.request)) ??
				new Response("Not Found", { status: 404 })
			)
		},
		async sw(context) {
			const url = new URL("/assets/app/assets/sw.ts", context.request.url)
			return (
				(await fetchAsset(new Request(url.toString()))) ??
				new Response("Not Found", { status: 404 })
			)
		},
		manifest(context) {
			const lang = resolveLang(context.request.headers.get("accept-language"))
			const t = createTranslator(lang)
			return new Response(
				JSON.stringify({
					name: "clockout",
					short_name: "clockout",
					description: t(
						"Lean, private time tracking that shows how much time is left today and this week.",
					),
					start_url: "/",
					display: "standalone",
					background_color: "#eaf4ff",
					theme_color: "hsl(206, 100%, 50%)",
					icons: [
						{
							src: "/icons/manifest-icon-192.maskable.png",
							sizes: "192x192",
							type: "image/png",
							purpose: "any maskable",
						},
						{
							src: "/icons/manifest-icon-512.maskable.png",
							sizes: "512x512",
							type: "image/png",
							purpose: "any maskable",
						},
					],
				}),
				{ headers: { "content-type": "application/manifest+json" } },
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
