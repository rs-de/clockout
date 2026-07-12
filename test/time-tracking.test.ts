import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
	createTrackingData,
	DEFAULT_DAILY_MAX,
	DEFAULT_WEEKLY_TARGET_MIN,
	formatDuration,
	isRunning,
	startOfWeek,
	summarize,
	type TrackingData,
	workedSecondsInRange,
} from "../app/utils/time-tracking.ts"

const H = 3600

describe("formatDuration", () => {
	test("formats whole hours and minutes", () => {
		assert.equal(formatDuration(9 * H + 55 * 60), "9h 55m")
	})

	test("pads single-digit minutes", () => {
		assert.equal(formatDuration(1 * H + 5 * 60), "1h 05m")
	})

	test("prefixes a negative sign when over", () => {
		assert.equal(formatDuration(-15 * 60), "-0h 15m")
	})

	test("formats zero", () => {
		assert.equal(formatDuration(0), "0h 00m")
	})
})

describe("createTrackingData", () => {
	test("generates a unique id and applies default settings", () => {
		const a = createTrackingData()
		const b = createTrackingData()

		assert.notEqual(a.id, b.id)
		assert.equal(a.settings.weeklyTargetMin, DEFAULT_WEEKLY_TARGET_MIN)
		assert.equal(a.settings.dailyMax, DEFAULT_DAILY_MAX)
		assert.deepEqual(a.events, [])
	})
})

describe("isRunning", () => {
	test("false with no events", () => {
		assert.equal(isRunning([]), false)
	})

	test("true when last event is an unmatched start", () => {
		assert.equal(isRunning([{ t: 100, type: "start" }]), true)
	})

	test("false when last event is a stop", () => {
		assert.equal(
			isRunning([
				{ t: 100, type: "start" },
				{ t: 200, type: "stop" },
			]),
			false,
		)
	})
})

describe("workedSecondsInRange", () => {
	test("sums multiple completed sessions in one day (e.g. a lunch break)", () => {
		const events = [
			{ t: 0, type: "start" as const },
			{ t: 2 * H, type: "stop" as const },
			{ t: 3 * H, type: "start" as const },
			{ t: 6 * H, type: "stop" as const },
		]
		const seconds = workedSecondsInRange(
			events,
			new Date(0),
			new Date(24 * H * 1000),
			new Date(6 * H * 1000),
		)
		assert.equal(seconds, 5 * H)
	})

	test("clips a session that spans the range boundary (e.g. across midnight)", () => {
		const events = [
			{ t: 22 * H, type: "start" as const },
			{ t: 26 * H, type: "stop" as const }, // 2h into the next day
		]
		const dayOneSeconds = workedSecondsInRange(
			events,
			new Date(0),
			new Date(24 * H * 1000),
			new Date(26 * H * 1000),
		)
		const dayTwoSeconds = workedSecondsInRange(
			events,
			new Date(24 * H * 1000),
			new Date(48 * H * 1000),
			new Date(26 * H * 1000),
		)
		assert.equal(dayOneSeconds, 2 * H)
		assert.equal(dayTwoSeconds, 2 * H)
	})

	test("counts an open (still running) start up to `now`", () => {
		const events = [{ t: 0, type: "start" as const }]
		const seconds = workedSecondsInRange(
			events,
			new Date(0),
			new Date(24 * H * 1000),
			new Date(1.5 * H * 1000),
		)
		assert.equal(seconds, 1.5 * H)
	})

	test("ignores sessions entirely outside the range", () => {
		const events = [
			{ t: -10 * H, type: "start" as const },
			{ t: -8 * H, type: "stop" as const },
		]
		const seconds = workedSecondsInRange(
			events,
			new Date(0),
			new Date(24 * H * 1000),
			new Date(24 * H * 1000),
		)
		assert.equal(seconds, 0)
	})
})

describe("startOfWeek", () => {
	test("is Monday 00:00 for a Wednesday", () => {
		const wednesday = new Date(2026, 6, 15, 13, 30) // 2026-07-15 is a Wednesday
		const monday = startOfWeek(wednesday)
		assert.equal(monday.getDay(), 1)
		assert.equal(monday.getHours(), 0)
		assert.equal(monday.getDate(), 13)
	})

	test("Sunday belongs to the preceding week", () => {
		const sunday = new Date(2026, 6, 19, 8, 0) // 2026-07-19 is a Sunday
		const monday = startOfWeek(sunday)
		assert.equal(monday.getDate(), 13)
	})
})

describe("summarize", () => {
	test("computes daily and weekly remaining time from events", () => {
		const data: TrackingData = {
			id: "test-doc",
			settings: { weeklyTargetMin: 35 * 60, dailyMax: 9 * 60 + 55 },
			events: [
				{ t: 0, type: "start" },
				{ t: 4 * H, type: "stop" },
			],
		}
		const summary = summarize(data, new Date(4 * H * 1000))

		assert.equal(summary.isRunning, false)
		assert.equal(summary.dailyWorkedSec, 4 * H)
		assert.equal(summary.dailyRemainingSec, (9 * 60 + 55) * 60 - 4 * H)
		assert.equal(summary.weeklyWorkedSec, 4 * H)
		assert.equal(summary.weeklyRemainingSec, 35 * 60 * 60 - 4 * H)
	})

	test("reflects an in-progress session live via `now`", () => {
		const data: TrackingData = {
			id: "test-doc",
			settings: { weeklyTargetMin: 35 * 60, dailyMax: 9 * 60 + 55 },
			events: [{ t: 0, type: "start" }],
		}
		const summary = summarize(data, new Date(1 * H * 1000))

		assert.equal(summary.isRunning, true)
		assert.equal(summary.dailyWorkedSec, 1 * H)
	})
})
