import "fake-indexeddb/auto"
import assert from "node:assert/strict"
import { afterEach, describe, test } from "node:test"
import {
	clearTrackingData,
	loadTrackingData,
	saveTrackingData,
} from "../app/utils/local-store.ts"
import { createTrackingData } from "../app/utils/time-tracking.ts"

describe("local-store", () => {
	afterEach(async () => {
		await clearTrackingData()
	})

	test("returns undefined when nothing has been saved", async () => {
		assert.equal(await loadTrackingData(), undefined)
	})

	test("round-trips a saved TrackingData document", async () => {
		const data = createTrackingData()
		data.events.push({ t: 0, type: "start" })

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
})
