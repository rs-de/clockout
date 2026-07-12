import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { createTrackingData } from "../app/utils/time-tracking.ts"
import {
	decryptTrackingData,
	deserializeEncryptedDocument,
	encryptTrackingData,
	serializeEncryptedDocument,
} from "../app/utils/tracking-document.ts"

const PASSWORD = "correct horse battery staple"

describe("serializeEncryptedDocument / deserializeEncryptedDocument", () => {
	test("round-trips through the JSON-safe wire form", async () => {
		const data = createTrackingData()
		data.events.push({ t: 0, type: "start" })
		const doc = await encryptTrackingData(data, PASSWORD)

		const serialized = serializeEncryptedDocument(doc)
		assert.equal(typeof serialized.salt, "string")
		assert.equal(typeof serialized.iv, "string")
		assert.equal(typeof serialized.ciphertext, "string")

		const deserialized = deserializeEncryptedDocument(serialized)
		const decrypted = await decryptTrackingData(deserialized, PASSWORD)
		assert.deepEqual(decrypted, data)
	})
})

describe("tracking-document", () => {
	test("round-trips a TrackingData document through encrypt/decrypt", async () => {
		const data = createTrackingData()
		data.events.push({ t: 0, type: "start" }, { t: 3600, type: "stop" })

		const doc = await encryptTrackingData(data, PASSWORD)
		const decrypted = await decryptTrackingData(doc, PASSWORD)

		assert.deepEqual(decrypted, data)
	})

	test("keeps the document id unencrypted for server routing", async () => {
		const data = createTrackingData()
		const doc = await encryptTrackingData(data, PASSWORD)
		assert.equal(doc.id, data.id)
	})

	test("fails to decrypt with the wrong password", async () => {
		const data = createTrackingData()
		const doc = await encryptTrackingData(data, PASSWORD)
		await assert.rejects(() => decryptTrackingData(doc, "wrong password"))
	})
})
