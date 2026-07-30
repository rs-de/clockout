import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
	buildExampleData,
	EXAMPLES,
	type Example,
	findExample,
	resolvePretendNow,
	resolveRelativeBlocks,
} from "../app/utils/examples.ts"
import { summarize } from "../app/utils/time-tracking.ts"

function testExample(pretendTime: string): Example {
	return {
		id: "test-example",
		title: "Test example",
		description: "",
		pretendTime,
		blocks: [],
	}
}

describe("findExample", () => {
	test("finds a known example by id", () => {
		assert.equal(findExample("lunch-break")?.id, "lunch-break")
	})

	test("undefined for an unknown id", () => {
		assert.equal(findExample("does-not-exist"), undefined)
	})
})

describe("resolvePretendNow", () => {
	test("uses today's real date at the example's own fixed pretendTime", () => {
		const example = testExample("09:05")
		const realNow = new Date(2026, 6, 13, 14, 32, 9)

		const pretendNow = resolvePretendNow(example, realNow)

		assert.equal(pretendNow.getFullYear(), 2026)
		assert.equal(pretendNow.getMonth(), 6)
		assert.equal(pretendNow.getDate(), 13)
		assert.equal(pretendNow.getHours(), 9)
		assert.equal(pretendNow.getMinutes(), 5)
		assert.equal(pretendNow.getSeconds(), 0)
	})

	test("stays valid regardless of which real day it's opened on", () => {
		const example = testExample("08:30")

		const fromA = resolvePretendNow(example, new Date(2026, 6, 15, 10, 0))
		const fromB = resolvePretendNow(example, new Date(2027, 2, 1, 10, 0))

		assert.equal(fromA.getDate(), 15)
		assert.equal(fromB.getDate(), 1)
		assert.equal(fromA.getHours(), 8)
		assert.equal(fromB.getHours(), 8)
	})
})

describe("resolveRelativeBlocks", () => {
	test("resolves start/end HH:MM against the pretend day", () => {
		const pretendNow = new Date(2026, 6, 15, 15, 0)
		const blocks = resolveRelativeBlocks(
			[{ start: "09:00", end: "12:00" }],
			pretendNow,
		)
		assert.deepEqual(blocks, [
			{
				start: Math.floor(new Date(2026, 6, 15, 9, 0).getTime() / 1000),
				end: Math.floor(new Date(2026, 6, 15, 12, 0).getTime() / 1000),
			},
		])
	})

	test("an omitted end resolves to a still-open block", () => {
		const pretendNow = new Date(2026, 6, 15, 15, 0)
		const blocks = resolveRelativeBlocks([{ start: "13:00" }], pretendNow)
		assert.deepEqual(blocks, [
			{
				start: Math.floor(new Date(2026, 6, 15, 13, 0).getTime() / 1000),
				end: null,
			},
		])
	})
})

describe("buildExampleData", () => {
	test("resolves a namespaced id and default settings", () => {
		const example = findExample("lunch-break")
		if (!example) throw new Error("expected the lunch-break example to exist")

		const data = buildExampleData(example, new Date(2026, 6, 15, 14, 0))

		assert.equal(data.id, "example-lunch-break")
		assert.equal(data.settings.dailyMinimum, 7 * 60)
	})

	test("lunch-break: two blocks, no extra trailing block since the last is still open", () => {
		const example = findExample("lunch-break")
		if (!example) throw new Error("expected the lunch-break example to exist")

		const data = buildExampleData(example, new Date(2026, 6, 15, 3, 0))

		assert.equal(data.blocks.length, 2)
		assert.equal(data.blocks[1]?.end, null)
	})

	test("depot-credit: an empty block list gets a trailing empty block", () => {
		const example = findExample("depot-credit")
		if (!example) throw new Error("expected the depot-credit example to exist")

		const data = buildExampleData(example, new Date(2026, 6, 15, 3, 0))

		assert.deepEqual(data.blocks, [{ start: null, end: null }])
		assert.equal(data.bookings.length, 1)
		assert.equal(data.bookings[0]?.depotAfterSec, example.depotSec)
	})

	test("an example with no depotSec starts with an empty bookings ledger", () => {
		const example = findExample("lunch-break")
		if (!example) throw new Error("expected the lunch-break example to exist")

		const data = buildExampleData(example, new Date(2026, 6, 15, 3, 0))

		assert.deepEqual(data.bookings, [])
	})
})

describe("EXAMPLES", () => {
	test("every example has a unique id", () => {
		const ids = EXAMPLES.map((example) => example.id)
		assert.equal(new Set(ids).size, ids.length)
	})

	test("depot-credit: the banked depot brings today's quitting time earlier", () => {
		const example = findExample("depot-credit")
		if (!example) throw new Error("expected the depot-credit example to exist")

		const realNow = new Date(2026, 6, 15, 10, 0)
		const data = buildExampleData(example, realNow)
		const pretendNow = resolvePretendNow(example, realNow)
		const summary = summarize(data, pretendNow)

		const pretendNowSec = Math.floor(pretendNow.getTime() / 1000)
		const withoutDepotQuittingTimeSec =
			pretendNowSec + data.settings.dailyMinimum * 60
		assert.equal(summary.depotSec, example.depotSec)
		assert.ok(summary.quittingTimeSec < withoutDepotQuittingTimeSec)
	})

	test("past-quitting-time: still running, quitting time already elapsed", () => {
		const example = findExample("past-quitting-time")
		if (!example)
			throw new Error("expected the past-quitting-time example to exist")

		const realNow = new Date(2026, 6, 15, 3, 0)
		const data = buildExampleData(example, realNow)
		const pretendNow = resolvePretendNow(example, realNow)
		const summary = summarize(data, pretendNow)

		assert.equal(summary.isRunning, true)
		assert.ok(summary.quittingTimeSec < Math.floor(pretendNow.getTime() / 1000))
	})

	test("done-for-today: booked out late, isDoneForToday instead of a fresh quitting time", () => {
		const example = findExample("done-for-today")
		if (!example)
			throw new Error("expected the done-for-today example to exist")

		const realNow = new Date(2026, 6, 15, 10, 0)
		const data = buildExampleData(example, realNow)
		const pretendNow = resolvePretendNow(example, realNow)
		const summary = summarize(data, pretendNow)

		assert.deepEqual(data.blocks, [{ start: null, end: null }])
		assert.equal(summary.isDoneForToday, true)
	})

	test("next-morning: a fresh, not-yet-started day, without skipStartLanding", () => {
		const example = findExample("next-morning")
		if (!example) throw new Error("expected the next-morning example to exist")

		const data = buildExampleData(example, new Date(2026, 6, 15, 3, 0))

		assert.deepEqual(data.blocks, [{ start: null, end: null }])
		assert.deepEqual(data.bookings, [])
		assert.equal(example.skipStartLanding, undefined)
	})

	test("depot-credit: opts out of the greeting landing via skipStartLanding", () => {
		const example = findExample("depot-credit")
		if (!example) throw new Error("expected the depot-credit example to exist")

		assert.equal(example.skipStartLanding, true)
	})
})
