import { get, put, route } from "remix/routes"

export const routes = route({
	assets: get("/assets/*path"),
	sw: get("/sw.js"),
	manifest: get("/manifest.webmanifest"),
	version: get("/api/version"),
	home: "/",
	doc: {
		// Bookmarkable per-document URL, used to recover after local storage is
		// cleared (fetch by id, then unlock with the password).
		show: "/d/:id",
		// A separate per-document manifest so an installed icon's start_url
		// points straight back at this document instead of the generic
		// landing page — see app/actions/doc/controller.tsx.
		manifest: get("/d/:id/manifest"),
	},
	// Throwaway demo data, seeded client-side only — see app/utils/examples.ts.
	example: get("/example/:id"),
	about: get("/about"),
	sync: route("sync", {
		get: get(":id"),
		put: put(":id"),
	}),
})
