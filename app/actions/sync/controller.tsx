import * as s from "remix/data-schema"
import { createController } from "remix/router"

import { syncStore } from "../../data/sync-store.server.ts"
import { routes } from "../../routes.ts"

// Matches the nanoid alphabet used for TrackingData ids; also guards against
// path traversal since ids become filenames in sync-store.server.ts.
const ID_PATTERN = /^[A-Za-z0-9_-]+$/
const idSchema = s.string().refine((value) => ID_PATTERN.test(value))

const documentSchema = s.object({
	id: idSchema,
	salt: s.string(),
	iv: s.string(),
	ciphertext: s.string(),
})

export default createController(routes.sync, {
	actions: {
		async get({ params }) {
			if (!s.parseSafe(idSchema, params.id).success) {
				return new Response("Invalid document id", { status: 400 })
			}

			const doc = await syncStore.read(params.id)
			if (!doc) return new Response("Not Found", { status: 404 })
			return new Response(JSON.stringify(doc), {
				headers: { "Content-Type": "application/json" },
			})
		},

		async put({ params, request }) {
			if (!s.parseSafe(idSchema, params.id).success) {
				return new Response("Invalid document id", { status: 400 })
			}

			const json = await request.json().catch(() => null)
			const result = s.parseSafe(documentSchema, json)
			if (!result.success) {
				return new Response("Invalid document", { status: 400 })
			}
			if (result.value.id !== params.id) {
				return new Response("Document id does not match route", {
					status: 400,
				})
			}

			await syncStore.write(result.value)
			return new Response(null, { status: 204 })
		},
	},
})
