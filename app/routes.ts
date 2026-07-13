import { get, put, route } from "remix/routes"

export const routes = route({
	assets: get("/assets/*path"),
	home: "/",
	// Bookmarkable per-document URL, used to recover after local storage is
	// cleared (fetch by id, then unlock with the password).
	doc: get("/d/:id"),
	// Throwaway demo data, seeded client-side only — see app/utils/examples.ts.
	example: get("/example/:id"),
	about: get("/about"),
	sync: route("sync", {
		get: get(":id"),
		put: put(":id"),
	}),
})
