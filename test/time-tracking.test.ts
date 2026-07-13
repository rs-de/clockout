import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
	catchupDays,
	createTrackingData,
	DEFAULT_DAILY_MAX,
	DEFAULT_WEEKLY_TARGET_MIN,
	formatDuration,
	isRunning,
	resolveCatchup,
	startOfWeek,
	summarize,
	type TrackingData,
	workedSecondsInRange,
} from "../app/utils/time-tracking.ts"

const H = 3600

function toSec(date: Date): number {
	return Math.floor(date.getTime() / 1000)
}

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

describe("catchupDays", () => {
	test("empty when there are no events at all", () => {
		assert.deepEqual(catchupDays([], new Date(2026, 6, 15)), [])
	})

	test("empty when the open start began today", () => {
		const events = [
			{ t: toSec(new Date(2026, 6, 15, 9, 0)), type: "start" as const },
		]
		assert.deepEqual(catchupDays(events, new Date(2026, 6, 15, 17, 0)), [])
	})

	test("empty when the last event is a stop from today", () => {
		const events = [
			{ t: toSec(new Date(2026, 6, 15, 9, 0)), type: "start" as const },
			{ t: toSec(new Date(2026, 6, 15, 12, 0)), type: "stop" as const },
		]
		assert.deepEqual(catchupDays(events, new Date(2026, 6, 15, 17, 0)), [])
	})

	test("one day when the open start began yesterday", () => {
		const events = [
			{ t: toSec(new Date(2026, 6, 14, 22, 0)), type: "start" as const },
		]
		const days = catchupDays(events, new Date(2026, 6, 15, 8, 0))
		assert.deepEqual(
			days.map((d) => d.getTime()),
			[new Date(2026, 6, 14).getTime()],
		)
	})

	test("one row per day up to (not including) today for a multi-day gap after an open start", () => {
		const events = [
			{ t: toSec(new Date(2026, 6, 10, 9, 0)), type: "start" as const },
		]
		const days = catchupDays(events, new Date(2026, 6, 14, 8, 0))
		assert.deepEqual(
			days.map((d) => d.getTime()),
			[10, 11, 12, 13].map((date) => new Date(2026, 6, date).getTime()),
		)
	})

	test("empty when a clean stop was yesterday (no full day missing yet)", () => {
		const events = [
			{ t: toSec(new Date(2026, 6, 14, 9, 0)), type: "start" as const },
			{ t: toSec(new Date(2026, 6, 14, 17, 0)), type: "stop" as const },
		]
		assert.deepEqual(catchupDays(events, new Date(2026, 6, 15, 8, 0)), [])
	})

	test("days after a clean stop, through yesterday, for a multi-day gap", () => {
		const events = [
			{ t: toSec(new Date(2026, 6, 10, 9, 0)), type: "start" as const },
			{ t: toSec(new Date(2026, 6, 10, 17, 0)), type: "stop" as const },
		]
		const days = catchupDays(events, new Date(2026, 6, 14, 8, 0))
		assert.deepEqual(
			days.map((d) => d.getTime()),
			[11, 12, 13].map((date) => new Date(2026, 6, date).getTime()),
		)
	})
})

describe("resolveCatchup", () => {
	test("returns events unchanged when there are no days to resolve", () => {
		const events = [
			{ t: 0, type: "start" as const },
			{ t: 1 * H, type: "stop" as const },
		]
		assert.deepEqual(resolveCatchup(events, [], []), events)
	})

	test("adds only a stop for the open start's own day, preserving its timestamp", () => {
		const startTs = toSec(new Date(2026, 6, 14, 22, 0))
		const events = [{ t: startTs, type: "start" as const }]
		const days = [new Date(2026, 6, 14)]

		assert.deepEqual(resolveCatchup(events, days, [90]), [
			{ t: startTs, type: "start" },
			{ t: startTs + 90 * 60, type: "stop" },
		])
	})

	test("adds a fresh start/stop pair for later days, skipping non-final 0-entries but always marking the last day", () => {
		const startTs = toSec(new Date(2026, 6, 10, 9, 0))
		const events = [{ t: startTs, type: "start" as const }]
		const days = [
			new Date(2026, 6, 10),
			new Date(2026, 6, 11),
			new Date(2026, 6, 12),
			new Date(2026, 6, 13),
		]
		const day11Start = toSec(new Date(2026, 6, 11))
		const day13Start = toSec(new Date(2026, 6, 13))

		// day 10 (open start, 0min): marker stop only. day 11 (120min): full
		// pair. day 12 (0min, not last): skipped entirely. day 13 (0min, but
		// last): still gets a zero-duration marker pair.
		assert.deepEqual(resolveCatchup(events, days, [0, 120, 0, 0]), [
			{ t: startTs, type: "start" },
			{ t: startTs, type: "stop" },
			{ t: day11Start, type: "start" },
			{ t: day11Start + 120 * 60, type: "stop" },
			{ t: day13Start, type: "start" },
			{ t: day13Start, type: "stop" },
		])
	})

	test("adds a fresh pair for every day after a clean stop, marking even a 0-entry last day", () => {
		const events = [
			{ t: toSec(new Date(2026, 6, 10, 9, 0)), type: "start" as const },
			{ t: toSec(new Date(2026, 6, 10, 17, 0)), type: "stop" as const },
		]
		const days = [new Date(2026, 6, 11), new Date(2026, 6, 12)]
		const day11Start = toSec(new Date(2026, 6, 11))
		const day12Start = toSec(new Date(2026, 6, 12))

		assert.deepEqual(resolveCatchup(events, days, [240, 0]), [
			...events,
			{ t: day11Start, type: "start" },
			{ t: day11Start + 240 * 60, type: "stop" },
			{ t: day12Start, type: "start" },
			{ t: day12Start, type: "stop" },
		])
	})

	test("regression: a 0-entry on the last day doesn't reopen the same day next render", () => {
		const events = [
			{ t: toSec(new Date(2026, 6, 10, 9, 0)), type: "start" as const },
			{ t: toSec(new Date(2026, 6, 10, 17, 0)), type: "stop" as const },
		]
		const now = new Date(2026, 6, 13, 8, 0)
		const days = catchupDays(events, now)

		const resolved = resolveCatchup(
			events,
			days,
			days.map(() => 0),
		)

		assert.deepEqual(catchupDays(resolved, now), [])
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
