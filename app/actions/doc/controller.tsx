import { createController } from "remix/router"
import { routes } from "../../routes.ts"
import { App } from "../../ui/app.tsx"
import { Document } from "../../ui/document.tsx"
import { createTranslator, resolveLang } from "../../utils/i18n.ts"

export default createController(routes.doc, {
	actions: {
		show(context) {
			const lang = resolveLang(context.request.headers.get("accept-language"))
			return context.render(
				<Document lang={lang} manifestHref={`/d/${context.params.id}/manifest`}>
					<App lang={lang} />
				</Document>,
			)
		},
		manifest(context) {
			const lang = resolveLang(context.request.headers.get("accept-language"))
			const t = createTranslator(lang)
			return Response.json({
				name: "ClockOut",
				short_name: "ClockOut",
				description: t(
					"Lean, private time tracking that shows how much time is left today and this week.",
				),
				start_url: `/d/${context.params.id}`,
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
			})
		},
	},
})
