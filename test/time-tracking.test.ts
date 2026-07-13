import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
	catchupDays,
	createTrackingData,
	DEFAULT_DAILY_MAX,
	DEFAULT_WEEKLY_TARGET_MIN,
	formatDuration,
	isRunning,
	MIN_SESSION_SEC,
	resolveCatchup,
	resolveRelativeEvents,
	startOfWeek,
	summarize,
	type TrackingData,
	toggleTracking,
	weeklyBreakdown,
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

describe("toggleTracking", () => {
	test("starts when stopped", () => {
		assert.deepEqual(toggleTracking([], 100), [{ t: 100, type: "start" }])
	})

	test("stops when running and the session is at least MIN_SESSION_SEC", () => {
		const events = [{ t: 0, type: "start" as const }]
		assert.deepEqual(toggleTracking(events, MIN_SESSION_SEC), [
			{ t: 0, type: "start" },
			{ t: MIN_SESSION_SEC, type: "stop" },
		])
	})

	test("discards the start instead of recording a session under MIN_SESSION_SEC", () => {
		const events = [
			{ t: 0, type: "start" as const },
			{ t: -100, type: "stop" as const },
		]
		assert.deepEqual(toggleTracking(events, MIN_SESSION_SEC - 1), [
			{ t: -100, type: "stop" },
		])
	})
})

describe("resolveRelativeEvents", () => {
	test("resolves daysAgo/time relative to now into a concrete timestamp", () => {
		const now = new Date(2026, 6, 15, 10, 0)
		const resolved = resolveRelativeEvents(
			[{ daysAgo: 3, time: "22:00", type: "start" }],
			now,
		)
		assert.deepEqual(resolved, [
			{ t: toSec(new Date(2026, 6, 12, 22, 0)), type: "start" },
		])
	})

	test("resolves multiple events, preserving order", () => {
		const now = new Date(2026, 6, 15, 10, 0)
		const resolved = resolveRelativeEvents(
			[
				{ daysAgo: 1, time: "09:00", type: "start" },
				{ daysAgo: 1, time: "17:00", type: "stop" },
				{ daysAgo: 0, time: "09:00", type: "start" },
			],
			now,
		)
		assert.deepEqual(resolved, [
			{ t: toSec(new Date(2026, 6, 14, 9, 0)), type: "start" },
			{ t: toSec(new Date(2026, 6, 14, 17, 0)), type: "stop" },
			{ t: toSec(new Date(2026, 6, 15, 9, 0)), type: "start" },
		])
	})

	test("stays valid regardless of which real day `now` falls on", () => {
		const nowA = new Date(2026, 6, 15, 10, 0)
		const nowB = new Date(2027, 2, 1, 10, 0)
		const descriptor = [{ daysAgo: 2, time: "08:30", type: "start" as const }]

		assert.deepEqual(resolveRelativeEvents(descriptor, nowA), [
			{ t: toSec(new Date(2026, 6, 13, 8, 30)), type: "start" },
		])
		assert.deepEqual(resolveRelativeEvents(descriptor, nowB), [
			{ t: toSec(new Date(2027, 1, 27, 8, 30)), type: "start" },
		])
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

	test("a skipDay marker contributes nothing and doesn't open or close a session", () => {
		const events = [
			{ t: 0, type: "skipDay" as const },
			{ t: 1 * H, type: "start" as const },
			{ t: 3 * H, type: "stop" as const },
		]
		const seconds = workedSecondsInRange(
			events,
			new Date(0),
			new Date(24 * H * 1000),
			new Date(24 * H * 1000),
		)
		assert.equal(seconds, 2 * H)
	})
})

describe("weeklyBreakdown", () => {
	test("returns one entry per day of the week, Monday first", () => {
		const now = new Date(2026, 6, 15, 13, 30) // Wednesday
		const breakdown = weeklyBreakdown([], now)

		assert.equal(breakdown.length, 7)
		assert.equal(breakdown[0]?.day.getDate(), 13) // Monday
		assert.equal(breakdown[6]?.day.getDate(), 19) // Sunday
		assert.ok(breakdown.every((entry) => entry.workedSec === 0))
	})

	test("attributes each day's worked seconds to the right entry", () => {
		const monday9to17 = [
			{ t: toSec(new Date(2026, 6, 13, 9, 0)), type: "start" as const },
			{ t: toSec(new Date(2026, 6, 13, 17, 0)), type: "stop" as const },
		]
		const tuesday9to12 = [
			{ t: toSec(new Date(2026, 6, 14, 9, 0)), type: "start" as const },
			{ t: toSec(new Date(2026, 6, 14, 12, 0)), type: "stop" as const },
		]
		const now = new Date(2026, 6, 15, 10, 0) // Wednesday

		const breakdown = weeklyBreakdown([...monday9to17, ...tuesday9to12], now)

		assert.equal(breakdown[0]?.workedSec, 8 * H) // Monday
		assert.equal(breakdown[1]?.workedSec, 3 * H) // Tuesday
		assert.equal(breakdown[2]?.workedSec, 0) // Wednesday, nothing yet
	})

	test("clips an open session live up to `now`", () => {
		const events = [
			{ t: toSec(new Date(2026, 6, 13, 9, 0)), type: "start" as const },
		]
		const now = new Date(2026, 6, 13, 11, 30) // same Monday, still running

		const breakdown = weeklyBreakdown(events, now)

		assert.equal(breakdown[0]?.workedSec, 2.5 * H)
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

	test("a trailing skipDay marker resolves the gap, same as a clean stop", () => {
		const events = [
			{ t: toSec(new Date(2026, 6, 10, 9, 0)), type: "start" as const },
			{ t: toSec(new Date(2026, 6, 10, 17, 0)), type: "stop" as const },
			{ t: toSec(new Date(2026, 6, 11)), type: "skipDay" as const },
		]
		assert.deepEqual(catchupDays(events, new Date(2026, 6, 12, 8, 0)), [])
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

	test("adds a fresh start/stop pair for worked days and a skipDay marker for every 0-entry day", () => {
		const startTs = toSec(new Date(2026, 6, 10, 9, 0))
		const events = [{ t: startTs, type: "start" as const }]
		const days = [
			new Date(2026, 6, 10),
			new Date(2026, 6, 11),
			new Date(2026, 6, 12),
			new Date(2026, 6, 13),
		]
		const day11Start = toSec(new Date(2026, 6, 11))
		const day12Start = toSec(new Date(2026, 6, 12))
		const day13Start = toSec(new Date(2026, 6, 13))

		// day 10 (open start, 0min): marker stop only, closing the real
		// dangling start. day 11 (120min): full pair. day 12 (0min, not
		// last): skipDay. day 13 (0min, last): also skipDay - every 0-entry
		// day is marked the same way now, not just the last.
		assert.deepEqual(resolveCatchup(events, days, [0, 120, 0, 0]), [
			{ t: startTs, type: "start" },
			{ t: startTs, type: "stop" },
			{ t: day11Start, type: "start" },
			{ t: day11Start + 120 * 60, type: "stop" },
			{ t: day12Start, type: "skipDay" },
			{ t: day13Start, type: "skipDay" },
		])
	})

	test("adds a fresh pair for worked days and a skipDay marker for a 0-entry day after a clean stop", () => {
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
			{ t: day12Start, type: "skipDay" },
		])
	})

	test("a skipDay marker never disrupts an overlapping real session", () => {
		// Day 0's session (chained from an 08:00 start plus a lot of hours)
		// can spill past midnight into a day the user separately marks as
		// skipped - the skipDay marker must still be a pure no-op so it can
		// never re-open/close a session it happens to fall inside of.
		const startTs = toSec(new Date(2026, 6, 13, 8, 0)) // Monday 08:00
		const events = [{ t: startTs, type: "start" as const }]
		const days = [new Date(2026, 6, 13), new Date(2026, 6, 14)]

		const resolved = resolveCatchup(events, days, [20 * 60, 0])

		assert.deepEqual(resolved, [
			{ t: startTs, type: "start" },
			{ t: startTs + 20 * H, type: "stop" }, // Tuesday 04:00
			{ t: toSec(new Date(2026, 6, 14)), type: "skipDay" }, // Tuesday 00:00
		])

		const summary = summarize(
			{
				id: "test-doc",
				settings: { weeklyTargetMin: 35 * 60, dailyMax: 9 * 60 + 55 },
				events: resolved,
			},
			new Date(2026, 6, 15, 10, 0),
		)
		// Full 20h still counted, unaffected by the skipDay marker landing
		// chronologically inside the session.
		assert.equal(summary.weeklyWorkedSec, 20 * H)
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

	test("regression: a large day-0 entry chains into later days instead of colliding or losing hours", () => {
		// An 08:00 start plus 20h would naturally end at 04:00 the next day,
		// landing after day 1's own start (00:00) and before day 1's own stop
		// (20:00) if day 1 were independently anchored at midnight -
		// workedSecondsInRange's start/stop toggle would then treat day 1's
		// start as re-opening the session, silently discarding day 0's hours,
		// and day 1's stop as closing an already-closed session, discarding
		// day 1's hours too. Chaining day 1 to start when day 0's session
		// actually ends (instead of always at midnight) keeps every pair
		// non-overlapping *and* credits the full entered duration for every
		// day - no clamping, no lost hours.
		const startTs = toSec(new Date(2026, 6, 13, 8, 0)) // Monday 08:00
		const events = [{ t: startTs, type: "start" as const }]
		const days = [
			new Date(2026, 6, 13),
			new Date(2026, 6, 14),
			new Date(2026, 6, 15),
		]

		const resolved = resolveCatchup(events, days, [20 * 60, 20 * 60, 20 * 60])

		// Three fully back-to-back 20h sessions: Mon 08:00 -> Tue 04:00 ->
		// Wed 00:00 -> Wed 20:00, each chained exactly where the last ended.
		assert.deepEqual(resolved, [
			{ t: startTs, type: "start" },
			{ t: startTs + 20 * H, type: "stop" },
			{ t: startTs + 20 * H, type: "start" },
			{ t: startTs + 40 * H, type: "stop" },
			{ t: startTs + 40 * H, type: "start" },
			{ t: startTs + 60 * H, type: "stop" },
		])

		const summary = summarize(
			{
				id: "test-doc",
				settings: { weeklyTargetMin: 35 * 60, dailyMax: 9 * 60 + 55 },
				events: resolved,
			},
			new Date(2026, 6, 16, 10, 0),
		)
		// Exactly 60h credited (35h target - 60h = -25h) - not the ~24h the
		// interleaving bug produced, nor a clamped ~56h.
		assert.equal(summary.weeklyWorkedSec, 60 * H)
		assert.equal(summary.weeklyRemainingSec, -25 * H)
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
		assert.equal(summary.startedAt, 0)
		assert.equal(summary.dailyWorkedSec, 4 * H)
		assert.equal(summary.dailyRemainingSec, (9 * 60 + 55) * 60 - 4 * H)
		assert.equal(summary.weeklyWorkedSec, 4 * H)
		assert.equal(summary.weeklyRemainingSec, 35 * 60 * 60 - 4 * H)
	})

	test("reflects an in-progress session live via `now`, including its start time", () => {
		const data: TrackingData = {
			id: "test-doc",
			settings: { weeklyTargetMin: 35 * 60, dailyMax: 9 * 60 + 55 },
			events: [{ t: 0, type: "start" }],
		}
		const summary = summarize(data, new Date(1 * H * 1000))

		assert.equal(summary.isRunning, true)
		assert.equal(summary.startedAt, 0)
		assert.equal(summary.dailyWorkedSec, 1 * H)
	})

	test("startedAt is null when tracking has never started", () => {
		const data: TrackingData = {
			id: "test-doc",
			settings: { weeklyTargetMin: 35 * 60, dailyMax: 9 * 60 + 55 },
			events: [],
		}
		assert.equal(summarize(data, new Date(0)).startedAt, null)
	})

	test("startedAt stays pinned to today's first start across a stop/restart (e.g. lunch break)", () => {
		const morningStart = toSec(new Date(2026, 6, 15, 9, 0))
		const lunchStop = toSec(new Date(2026, 6, 15, 12, 0))
		const afternoonStart = toSec(new Date(2026, 6, 15, 13, 0))
		const data: TrackingData = {
			id: "test-doc",
			settings: { weeklyTargetMin: 35 * 60, dailyMax: 9 * 60 + 55 },
			events: [
				{ t: morningStart, type: "start" },
				{ t: lunchStop, type: "stop" },
				{ t: afternoonStart, type: "start" },
			],
		}
		const summary = summarize(data, new Date(2026, 6, 15, 14, 0))

		assert.equal(summary.isRunning, true)
		assert.equal(summary.startedAt, morningStart)
	})

	test("startedAt is null if nothing has started today, even after yesterday's activity", () => {
		const yesterdayStart = toSec(new Date(2026, 6, 14, 9, 0))
		const yesterdayStop = toSec(new Date(2026, 6, 14, 17, 0))
		const data: TrackingData = {
			id: "test-doc",
			settings: { weeklyTargetMin: 35 * 60, dailyMax: 9 * 60 + 55 },
			events: [
				{ t: yesterdayStart, type: "start" },
				{ t: yesterdayStop, type: "stop" },
			],
		}
		const summary = summarize(data, new Date(2026, 6, 15, 8, 0))

		assert.equal(summary.startedAt, null)
	})

	test("dailyRemainingSec floors at 0 once the week's target is already met, even if today has no work yet", () => {
		const data: TrackingData = {
			id: "test-doc",
			settings: { weeklyTargetMin: 35 * 60, dailyMax: 9 * 60 + 55 },
			events: [
				// 72h logged Mon 09:00 -> Thu 09:00, already well over the 35h target.
				{ t: toSec(new Date(2026, 6, 13, 9, 0)), type: "start" },
				{ t: toSec(new Date(2026, 6, 16, 9, 0)), type: "stop" },
			],
		}
		// Friday, nothing logged yet today.
		const summary = summarize(data, new Date(2026, 6, 17, 10, 0))

		assert.ok(summary.weeklyRemainingSec < 0)
		assert.equal(summary.dailyRemainingSec, 0)
	})

	test("dailyRemainingSec keeps a real same-day overage even when the week is also already over", () => {
		const data: TrackingData = {
			id: "test-doc",
			settings: { weeklyTargetMin: 35 * 60, dailyMax: 9 * 60 + 55 },
			events: [
				// 72h logged Mon 09:00 -> Thu 09:00, plus 12h logged today
				// (Friday) - both the week and today's own daily max are
				// individually blown.
				{ t: toSec(new Date(2026, 6, 13, 9, 0)), type: "start" },
				{ t: toSec(new Date(2026, 6, 16, 9, 0)), type: "stop" },
				{ t: toSec(new Date(2026, 6, 17, 8, 0)), type: "start" },
				{ t: toSec(new Date(2026, 6, 17, 20, 0)), type: "stop" },
			],
		}
		const summary = summarize(data, new Date(2026, 6, 17, 21, 0))

		const dailyMaxSec = (9 * 60 + 55) * 60
		assert.ok(summary.weeklyRemainingSec < 0)
		assert.equal(summary.dailyRemainingSec, dailyMaxSec - 12 * H)
	})

	test("dailyRemainingSec is unaffected while the week still has time left", () => {
		const data: TrackingData = {
			id: "test-doc",
			settings: { weeklyTargetMin: 35 * 60, dailyMax: 9 * 60 + 55 },
			events: [],
		}
		const summary = summarize(data, new Date(2026, 6, 17, 10, 0))

		assert.ok(summary.weeklyRemainingSec > 0)
		assert.equal(summary.dailyRemainingSec, (9 * 60 + 55) * 60)
	})
})
