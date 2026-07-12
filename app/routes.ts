import { get, put, route } from "remix/routes"

export const routes = route({
	assets: get("/assets/*path"),
	home: "/",
	sync: route("sync", {
		get: get(":id"),
		put: put(":id"),
	}),
})
