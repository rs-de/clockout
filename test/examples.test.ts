import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
	buildExampleData,
	EXAMPLES,
	type Example,
	findExample,
	resolvePretendNow,
} from "../app/utils/examples.ts"
import { summarize } from "../app/utils/time-tracking.ts"

function testExample(pretendWeekday: number, pretendTime = "16:00"): Example {
	return {
		id: "test-example",
		title: "Test example",
		description: "",
		pretendWeekday,
		pretendTime,
		events: [],
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
	test("lands on the requested weekday within the real current week", () => {
		const example = testExample(4)

		// A Monday and a Sunday of the *same* real ISO week should both
		// resolve to that week's Friday.
		const monday = new Date(2026, 6, 13, 10, 30)
		const sunday = new Date(2026, 6, 19, 8, 0)

		assert.equal(resolvePretendNow(example, monday).getDate(), 17)
		assert.equal(resolvePretendNow(example, sunday).getDate(), 17)
	})

	test("uses the example's own fixed pretendTime, not the real time-of-day", () => {
		const example = testExample(4, "09:05")
		const now = new Date(2026, 6, 13, 14, 32, 9)

		const pretendNow = resolvePretendNow(example, now)

		assert.equal(pretendNow.getHours(), 9)
		assert.equal(pretendNow.getMinutes(), 5)
		assert.equal(pretendNow.getSeconds(), 0)
	})
})

describe("buildExampleData", () => {
	test("resolves a namespaced id and default settings", () => {
		const example = findExample("lunch-break")
		if (!example) throw new Error("expected the lunch-break example to exist")

		const data = buildExampleData(example, new Date(2026, 6, 15, 14, 0))

		assert.equal(data.id, "example-lunch-break")
		assert.equal(data.events.length, 7)
	})

	test("steady-week's history lands in the same real week regardless of which real weekday it's built on", () => {
		const example = findExample("steady-week")
		if (!example) throw new Error("expected the steady-week example to exist")

		// This is the scenario that motivated pretendWeekday: building the
		// same example on a Monday morning must not scatter its history into
		// last week's bucket, or "week remaining" would look untouched.
		const monday = new Date(2026, 6, 13, 8, 0)
		const friday = new Date(2026, 6, 17, 16, 0)

		const fromMonday = buildExampleData(example, monday)
		const fromFriday = buildExampleData(example, friday)

		assert.deepEqual(fromMonday.events, fromFriday.events)

		const weeklyFromMonday = summarize(
			fromMonday,
			resolvePretendNow(example, monday),
		).weeklyWorkedSec
		const weeklyFromFriday = summarize(
			fromFriday,
			resolvePretendNow(example, friday),
		).weeklyWorkedSec

		assert.ok(weeklyFromMonday > 0)
		assert.equal(weeklyFromMonday, weeklyFromFriday)
	})

	test("the open Friday session in steady-week has already started relative to its own anchor", () => {
		const example = findExample("steady-week")
		if (!example) throw new Error("expected the steady-week example to exist")

		// A very early real hour is the case that broke the earlier
		// real-time-of-day design: the pretend "now" must still land after
		// the Friday start time regardless of what real hour this is built at.
		const realNow = new Date(2026, 6, 13, 3, 0)
		const data = buildExampleData(example, realNow)
		const summary = summarize(data, resolvePretendNow(example, realNow))

		assert.equal(summary.isRunning, true)
		assert.ok(
			summary.dailyWorkedSec > 0,
			"the still-open Friday session should already contribute worked time relative to its own anchor, not look like it hasn't started yet",
		)
	})
})

describe("EXAMPLES", () => {
	test("every example has a unique id", () => {
		const ids = EXAMPLES.map((example) => example.id)
		assert.equal(new Set(ids).size, ids.length)
	})
})
