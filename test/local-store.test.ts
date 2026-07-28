import "fake-indexeddb/auto"
import assert from "node:assert/strict"
import { afterEach, describe, test } from "node:test"
import {
	clearTrackingData,
	loadSyncKey,
	loadTrackingData,
	saveSyncKey,
	saveTrackingData,
} from "../app/utils/local-store.ts"
import { createTrackingData } from "../app/utils/time-tracking.ts"
import { deriveTrackingKey } from "../app/utils/tracking-document.ts"

describe("local-store", () => {
	afterEach(async () => {
		await clearTrackingData()
	})

	test("returns undefined when nothing has been saved", async () => {
		assert.equal(await loadTrackingData(), undefined)
	})

	test("round-trips a saved TrackingData document", async () => {
		const data = createTrackingData()
		data.blocks = [{ start: 0, end: null }]

		await saveTrackingData(data)
		const loaded = await loadTrackingData()

		assert.deepEqual(loaded, data)
	})

	test("overwrites the previous save", async () => {
		const first = createTrackingData()
		const second = createTrackingData()

		await saveTrackingData(first)
		await saveTrackingData(second)

		const loaded = await loadTrackingData()
		assert.equal(loaded?.id, second.id)
	})

	test("clearTrackingData removes the saved document", async () => {
		await saveTrackingData(createTrackingData())
		await clearTrackingData()

		assert.equal(await loadTrackingData(), undefined)
	})

	test("returns undefined when no sync key has been saved", async () => {
		assert.equal(await loadSyncKey(), undefined)
	})

	test("round-trips a saved sync key, still usable for decrypt", async () => {
		const syncKey = await deriveTrackingKey("correct horse battery staple")

		await saveSyncKey(syncKey)
		const loaded = await loadSyncKey()

		assert.ok(loaded)
		assert.deepEqual(loaded.salt, syncKey.salt)
		assert.equal(loaded.key.extractable, false)
	})

	test("clearTrackingData also removes the saved sync key", async () => {
		await saveSyncKey(await deriveTrackingKey("correct horse battery staple"))
		await clearTrackingData()

		assert.equal(await loadSyncKey(), undefined)
	})
})
