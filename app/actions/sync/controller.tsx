import * as s from "remix/data-schema"
import { maxLength } from "remix/data-schema/checks"
import { createController } from "remix/router"

import { syncStore } from "../../data/sync-store.server.ts"
import { routes } from "../../routes.ts"

// Matches the nanoid alphabet used for TrackingData ids; also guards against
// path traversal since ids become filenames in sync-store.server.ts. The
// default nanoid() is 21 characters — 64 leaves headroom without letting an
// arbitrarily long id become a filename (and a disk-fill vector).
const ID_PATTERN = /^[A-Za-z0-9_-]+$/
const idSchema = s
	.string()
	.pipe(maxLength(64))
	.refine((value) => ID_PATTERN.test(value))

// Base64 of a fixed-size value (16-byte salt, 12-byte IV — see crypto.ts) —
// generous slack over the exact expected length (24 / 16 chars), not a
// precise check: a mismatched length just fails to decrypt client-side
// later, same as any other tampering. This only guards against an
// unbounded string being written to disk.
const documentSchema = s.object({
	id: idSchema,
	salt: s.string().pipe(maxLength(64)),
	iv: s.string().pipe(maxLength(64)),
	// Scales with how much history the doc holds; 2,000,000 chars (~2MB)
	// comfortably covers years of daily events while still bounding the
	// worst case a single PUT can write to disk.
	ciphertext: s.string().pipe(maxLength(2_000_000)),
})

// request.json() below buffers the whole body into memory before the
// schema's maxLength checks ever run — those bound what gets written to
// disk, not what gets read off the wire. This rejects an oversized body via
// the standard Content-Length header before that buffering happens, so an
// oversized PUT can't be used to exhaust memory even before validation.
const MAX_BODY_BYTES = 2_100_000 // headroom over the 2MB ciphertext cap for JSON framing/salt/iv

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

			const contentLength = Number(request.headers.get("content-length"))
			if (
				!Number.isFinite(contentLength) ||
				contentLength <= 0 ||
				contentLength > MAX_BODY_BYTES
			) {
				return new Response("Payload too large", { status: 413 })
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
