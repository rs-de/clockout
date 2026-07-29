import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
	applyBlockEdits,
	blockDurationSec,
	bookDay,
	createTrackingData,
	DEFAULT_DAILY_MAX,
	DEFAULT_DAILY_MINIMUM,
	defaultBookingSec,
	depotSec,
	formatDuration,
	isCurrentTrackingData,
	isRunning,
	MIN_SESSION_SEC,
	previewDepotAfterBooking,
	quittingTimeSec,
	setBlockField,
	startBlock,
	stopBlock,
	summarize,
	type TrackingData,
	workedSec,
} from "../app/utils/time-tracking.ts"

const H = 3600

function settings(overrides: Partial<TrackingData["settings"]> = {}) {
	return { dailyMinimum: 7 * 60, dailyMax: 9 * 60 + 55, ...overrides }
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
		assert.equal(a.settings.dailyMinimum, DEFAULT_DAILY_MINIMUM)
		assert.equal(a.settings.dailyMax, DEFAULT_DAILY_MAX)
		assert.deepEqual(a.blocks, [{ start: null, end: null }])
		assert.deepEqual(a.bookings, [])
	})
})

describe("isCurrentTrackingData", () => {
	test("true for a document built by createTrackingData", () => {
		assert.equal(isCurrentTrackingData(createTrackingData()), true)
	})

	// The shape actually persisted by v0.2.5 (weekly target + flat event log,
	// no blocks/bookings) — see diary #97.
	test("false for a pre-rewrite weekly/event-log document", () => {
		const legacy = {
			id: "abc",
			settings: { weeklyTargetMin: 35 * 60, dailyMax: 9 * 60 + 55 },
			events: [{ t: 0, type: "start" }],
		} as unknown as TrackingData
		assert.equal(isCurrentTrackingData(legacy), false)
	})

	test("false when only one of blocks/bookings is present", () => {
		const partial = {
			...createTrackingData(),
			bookings: undefined,
		} as unknown as TrackingData
		assert.equal(isCurrentTrackingData(partial), false)
	})
})

describe("setBlockField / trailing-block invariant", () => {
	test("filling the trailing block's start doesn't append another block yet", () => {
		const blocks = setBlockField([{ start: null, end: null }], 0, "start", 100)
		assert.deepEqual(blocks, [{ start: 100, end: null }])
	})

	test("completing a block auto-appends a fresh empty block (req #7)", () => {
		const blocks = setBlockField([{ start: 0, end: null }], 0, "end", 200)
		assert.deepEqual(blocks, [
			{ start: 0, end: 200 },
			{ start: null, end: null },
		])
	})

	test("discards a pair shorter than MIN_SESSION_SEC back to empty (req #10)", () => {
		const blocks = setBlockField([{ start: 0, end: null }], 0, "end", 30)
		assert.deepEqual(blocks, [{ start: null, end: null }])
	})

	test("discards an end typed before its start the same way", () => {
		const blocks = setBlockField([{ start: 100, end: null }], 0, "end", 50)
		assert.deepEqual(blocks, [{ start: null, end: null }])
	})

	test("editing an earlier, already-complete block doesn't touch the trailing empty one", () => {
		const initial = [
			{ start: 0, end: 1 * H },
			{ start: null, end: null },
		]
		const blocks = setBlockField(initial, 0, "start", 10 * 60)
		assert.deepEqual(blocks, [
			{ start: 10 * 60, end: 1 * H },
			{ start: null, end: null },
		])
	})
})

describe("applyBlockEdits", () => {
	test("applies one edit per existing block in order", () => {
		const initial = [
			{ start: 0, end: 1 * H },
			{ start: 2 * H, end: null },
		]
		const blocks = applyBlockEdits(initial, [
			{ start: 0, end: 1 * H },
			{ start: 2 * H, end: 3 * H },
		])
		assert.deepEqual(blocks, [
			{ start: 0, end: 1 * H },
			{ start: 2 * H, end: 3 * H },
			{ start: null, end: null },
		])
	})

	test("discards a pair shorter than MIN_SESSION_SEC back to empty (req #10)", () => {
		const initial = [{ start: null, end: null }]
		const blocks = applyBlockEdits(initial, [{ start: 0, end: 30 }])
		assert.deepEqual(blocks, [{ start: null, end: null }])
	})

	test("discards an end with no start at all", () => {
		// The end field is never disabled in the UI (app.tsx) — this is the
		// only guard against a stray end-only block.
		const initial = [{ start: null, end: null }]
		const blocks = applyBlockEdits(initial, [{ start: null, end: 1 * H }])
		assert.deepEqual(blocks, [{ start: null, end: null }])
	})

	test("collapses an earlier block cleared back to empty, instead of leaving a stray empty row", () => {
		const initial = [
			{ start: 0, end: 1 * H },
			{ start: null, end: null },
		]
		// Clearing just the first block's start (its end left stale at 1*H,
		// same as a form submit with the end field disabled) discards it back
		// to empty via normalizeBlock — leaving two empty blocks, one from
		// that discard and one already-trailing, unless collapsed into one.
		const blocks = applyBlockEdits(initial, [
			{ start: null, end: 1 * H },
			{ start: null, end: null },
		])
		assert.deepEqual(blocks, [{ start: null, end: null }])
	})

	test("re-asserts the trailing-empty-block invariant only once at the end", () => {
		const initial = [
			{ start: null, end: null },
			{ start: null, end: null },
		]
		const blocks = applyBlockEdits(initial, [
			{ start: 0, end: 1 * H },
			{ start: null, end: null },
		])
		assert.deepEqual(blocks, [
			{ start: 0, end: 1 * H },
			{ start: null, end: null },
		])
	})
})

describe("startBlock / stopBlock", () => {
	test("startBlock fills the trailing block's start", () => {
		const blocks = startBlock([{ start: null, end: null }], 100)
		assert.deepEqual(blocks, [{ start: 100, end: null }])
	})

	test("startBlock is a no-op once already started", () => {
		const blocks = [{ start: 100, end: null }]
		assert.deepEqual(startBlock(blocks, 200), blocks)
	})

	test("stopBlock closes the block and appends a fresh empty one", () => {
		const blocks = stopBlock([{ start: 0, end: null }], MIN_SESSION_SEC)
		assert.deepEqual(blocks, [
			{ start: 0, end: MIN_SESSION_SEC },
			{ start: null, end: null },
		])
	})

	test("stopBlock discards a too-short session instead of closing it", () => {
		const blocks = stopBlock([{ start: 0, end: null }], MIN_SESSION_SEC - 1)
		assert.deepEqual(blocks, [{ start: null, end: null }])
	})

	test("stopBlock is a no-op when nothing is running", () => {
		const blocks = [{ start: null, end: null }]
		assert.deepEqual(stopBlock(blocks, 100), blocks)
	})
})

describe("isRunning", () => {
	test("false for a fresh (empty) block list", () => {
		assert.equal(isRunning([{ start: null, end: null }]), false)
	})

	test("true while the trailing block is open", () => {
		assert.equal(isRunning([{ start: 100, end: null }]), true)
	})

	test("false once the trailing block is closed (a fresh one follows)", () => {
		assert.equal(
			isRunning([
				{ start: 0, end: 100 },
				{ start: null, end: null },
			]),
			false,
		)
	})
})

describe("blockDurationSec / workedSec", () => {
	test("a completed block counts its fixed duration", () => {
		assert.equal(blockDurationSec({ start: 0, end: 2 * H }, 5 * H), 2 * H)
	})

	test("an open block counts elapsed time up to now", () => {
		assert.equal(blockDurationSec({ start: 0, end: null }, 1.5 * H), 1.5 * H)
	})

	test("an unfilled block counts nothing", () => {
		assert.equal(blockDurationSec({ start: null, end: null }, 5 * H), 0)
	})

	test("sums multiple blocks in one day (e.g. a lunch break)", () => {
		const blocks = [
			{ start: 0, end: 2 * H },
			{ start: 3 * H, end: 6 * H },
			{ start: null, end: null },
		]
		assert.equal(workedSec(blocks, 6 * H), 5 * H)
	})
})

describe("depotSec", () => {
	test("0 with no bookings yet", () => {
		const data = createTrackingData(settings())
		assert.equal(depotSec(data), 0)
	})

	test("the latest booking's depotAfterSec, not a sum of deltas", () => {
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: null, end: null }],
			bookings: [
				{ t: 0, workedSec: 8 * H, bookingSec: 8 * H, depotAfterSec: 1 * H },
				{ t: 1, workedSec: 8 * H, bookingSec: 8 * H, depotAfterSec: 2 * H },
			],
		}
		assert.equal(depotSec(data), 2 * H)
	})
})

describe("quittingTimeSec", () => {
	test("now + dailyMin when nothing worked and no depot", () => {
		const data = createTrackingData(settings())
		assert.equal(quittingTimeSec(data, 0), 7 * H)
	})

	test("an existing depot pulls it earlier", () => {
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: null, end: null }],
			bookings: [{ t: 0, workedSec: 0, bookingSec: 0, depotAfterSec: 1 * H }],
		}
		assert.equal(quittingTimeSec(data, 0), 6 * H)
	})

	test("stays fixed while a block is running, as `now` advances", () => {
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 9 * H, end: null }],
			bookings: [],
		}
		assert.equal(quittingTimeSec(data, 10 * H), quittingTimeSec(data, 11 * H))
	})

	test("recedes once tracking pauses (now advances, worked time doesn't)", () => {
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 9 * H, end: 10 * H }],
			bookings: [],
		}
		assert.ok(quittingTimeSec(data, 11 * H) > quittingTimeSec(data, 10 * H))
	})

	test("can land in the past once the minimum is already covered", () => {
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: 8 * H }],
			bookings: [],
		}
		assert.ok(quittingTimeSec(data, 9 * H) < 9 * H)
	})

	test("freezes at the closed block's end once the minimum is already covered, instead of drifting with `now`", () => {
		// 4h worked + 3h already in the depot exactly covers the 7h minimum —
		// the moment that happened is fixed (the block's own end), so it must
		// read the same however much later it's checked.
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: 4 * H }],
			bookings: [{ t: -1, workedSec: 0, bookingSec: 0, depotAfterSec: 3 * H }],
		}
		assert.equal(quittingTimeSec(data, 4 * H), 4 * H)
		assert.equal(quittingTimeSec(data, 4 * H), quittingTimeSec(data, 20 * H))
	})

	test("freezes at the past instant the minimum was covered, even past that block's own end", () => {
		// 5h worked (ending at 5h) + 3h depot overshoots the 7h minimum by
		// 1h — the fixed crossing instant is 1h before the block actually
		// ended (4h), not a value that keeps trailing behind `now`.
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: 5 * H }],
			bookings: [{ t: -1, workedSec: 0, bookingSec: 0, depotAfterSec: 3 * H }],
		}
		assert.equal(quittingTimeSec(data, 5 * H), 4 * H)
		assert.equal(quittingTimeSec(data, 5 * H), quittingTimeSec(data, 20 * H))
	})
})

describe("defaultBookingSec", () => {
	test("equals worked time when under the daily max", () => {
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: 8 * H }],
			bookings: [],
		}
		assert.equal(defaultBookingSec(data, 8 * H), 8 * H)
	})

	test("caps at the daily max once worked time exceeds it", () => {
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: 11 * H }],
			bookings: [],
		}
		assert.equal(defaultBookingSec(data, 11 * H), (9 * 60 + 55) * 60)
	})

	test("tops up a short day with available depot", () => {
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: 5 * H }],
			bookings: [
				{ t: -1, workedSec: 8 * H, bookingSec: 8 * H, depotAfterSec: 1 * H },
			],
		}
		assert.equal(defaultBookingSec(data, 5 * H), 6 * H)
	})

	test("caps the depot top-up at the daily max, not worked + full depot", () => {
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: 5 * H }],
			bookings: [
				{ t: -1, workedSec: 8 * H, bookingSec: 8 * H, depotAfterSec: 10 * H },
			],
		}
		assert.equal(defaultBookingSec(data, 5 * H), (9 * 60 + 55) * 60)
	})
})

describe("bookDay", () => {
	test("a day under the minimum banks nothing", () => {
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: 5 * H }],
			bookings: [],
		}
		const booked = bookDay(data, defaultBookingSec(data, 5 * H), 5 * H)
		assert.equal(depotSec(booked), 0)
	})

	test("a day over the minimum but under the max banks nothing — booked in full", () => {
		const worked = 8.5 * H
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: worked }],
			bookings: [],
		}
		const booked = bookDay(data, defaultBookingSec(data, worked), worked)
		assert.equal(depotSec(booked), 0)
	})

	test("a day over the max banks exactly the unbookable overflow", () => {
		const worked = 11 * H
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: worked }],
			bookings: [],
		}
		const booked = bookDay(data, defaultBookingSec(data, worked), worked)
		assert.equal(depotSec(booked), worked - (9 * 60 + 55) * 60)
	})

	test("the banked total depends on the exact bookingSec — less booked banks more", () => {
		const worked = 8 * H
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: worked }],
			bookings: [],
		}
		const bookedFull = bookDay(data, worked, worked)
		const bookedLower = bookDay(data, 7.5 * H, worked)
		assert.equal(depotSec(bookedFull), 0)
		assert.equal(depotSec(bookedLower), 0.5 * H)
	})

	test("booking below what was worked banks the un-booked remainder in full", () => {
		const worked = 8 * H
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: worked }],
			bookings: [],
		}
		// Booked only 6h out of 8h worked: the un-booked 2h still banks in
		// full, regardless of where the 7h minimum falls.
		const booked = bookDay(data, 6 * H, worked)
		assert.equal(depotSec(booked), 2 * H)
	})

	test("clamps a bookingSec above what was actually worked", () => {
		const worked = 3 * H
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: worked }],
			bookings: [],
		}
		const booked = bookDay(data, 100 * H, worked)
		assert.equal(booked.bookings.at(-1)?.bookingSec, worked)
	})

	test("a short day topped up from the depot draws it down by the gap", () => {
		const worked = 5 * H
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: worked }],
			bookings: [
				{ t: -1, workedSec: 8 * H, bookingSec: 8 * H, depotAfterSec: 3 * H },
			],
		}
		// Below dailyMin (7h) even after the top-up, so nothing is earned —
		// the full 3h drawn from the depot to reach 8h is a straight deduction.
		const booked = bookDay(data, defaultBookingSec(data, worked), worked)
		assert.equal(booked.bookings.at(-1)?.bookingSec, 8 * H)
		assert.equal(depotSec(booked), 0)
	})

	test("a top-up beyond worked time draws the depot down by the full gap", () => {
		const worked = 8 * H
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: worked }],
			bookings: [
				{ t: -1, workedSec: 8 * H, bookingSec: 8 * H, depotAfterSec: 2 * H },
			],
		}
		// Booking the full daily max (9h55m) draws the entire 1h55m gap above
		// the 8h worked from the depot — the 8h itself, being under the max,
		// earns no offsetting credit anymore.
		const booked = bookDay(data, defaultBookingSec(data, worked), worked)
		assert.equal(booked.bookings.at(-1)?.bookingSec, (9 * 60 + 55) * 60)
		assert.equal(depotSec(booked), 2 * H - (1 * H + 55 * 60))
	})

	test("still clamps a bookingSec beyond worked time plus available depot", () => {
		const worked = 3 * H
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: worked }],
			bookings: [
				{ t: -1, workedSec: 1 * H, bookingSec: 1 * H, depotAfterSec: 1 * H },
			],
		}
		const booked = bookDay(data, 100 * H, worked)
		// Clamped to worked (3h) + depot (1h) = 4h, well under the daily max.
		assert.equal(booked.bookings.at(-1)?.bookingSec, 4 * H)
		assert.equal(depotSec(booked), 0)
	})

	test("clamps a bookingSec above the daily max", () => {
		const worked = 11 * H
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: worked }],
			bookings: [],
		}
		const booked = bookDay(data, 100 * H, worked)
		assert.equal(booked.bookings.at(-1)?.bookingSec, (9 * 60 + 55) * 60)
	})

	test("clamps a negative bookingSec up to 0", () => {
		const worked = 8 * H
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: worked }],
			bookings: [],
		}
		const booked = bookDay(data, -100, worked)
		assert.equal(booked.bookings.at(-1)?.bookingSec, 0)
		assert.equal(depotSec(booked), worked)
	})

	test("resets blocks to a single empty one and appends to the ledger", () => {
		const worked = 8 * H
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: worked }],
			bookings: [
				{ t: -1, workedSec: 1 * H, bookingSec: 1 * H, depotAfterSec: 5 * 60 },
			],
		}
		const booked = bookDay(data, worked, worked)

		assert.deepEqual(booked.blocks, [{ start: null, end: null }])
		assert.equal(booked.bookings.length, 2)
		assert.equal(booked.bookings[0]?.depotAfterSec, 5 * 60)
		// Booked exactly what was worked (under the max) — banks nothing on
		// top, so the depot is unchanged from before this booking.
		assert.equal(depotSec(booked), 5 * 60)
	})
})

describe("previewDepotAfterBooking", () => {
	test("matches bookDay's resulting depot for the same inputs, without mutating", () => {
		const worked = 8.5 * H
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: worked }],
			bookings: [],
		}
		const bookingSec = defaultBookingSec(data, worked)
		assert.equal(
			previewDepotAfterBooking(data, bookingSec, worked),
			depotSec(bookDay(data, bookingSec, worked)),
		)
		// Preview must not have touched the original data.
		assert.equal(data.bookings.length, 0)
	})

	test("matches bookDay when topping up a short day from the depot", () => {
		const worked = 5 * H
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: worked }],
			bookings: [
				{ t: -1, workedSec: 8 * H, bookingSec: 8 * H, depotAfterSec: 3 * H },
			],
		}
		const bookingSec = defaultBookingSec(data, worked)
		assert.equal(
			previewDepotAfterBooking(data, bookingSec, worked),
			depotSec(bookDay(data, bookingSec, worked)),
		)
	})

	test("matches bookDay's clamp when bookingSec exceeds worked plus depot", () => {
		const worked = 3 * H
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: worked }],
			bookings: [],
		}
		assert.equal(
			previewDepotAfterBooking(data, 100 * H, worked),
			depotSec(bookDay(data, 100 * H, worked)),
		)
	})
})

describe("summarize", () => {
	test("bundles the running state, worked/depot time, and quitting time consistently", () => {
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: null }],
			bookings: [
				{ t: -1, workedSec: 1 * H, bookingSec: 1 * H, depotAfterSec: 30 * 60 },
			],
		}
		const now = 2 * H
		const summary = summarize(data, new Date(now * 1000))

		assert.equal(summary.isRunning, true)
		assert.equal(summary.workedSec, 2 * H)
		assert.equal(summary.depotSec, 30 * 60)
		assert.equal(summary.quittingTimeSec, now + 7 * H - 30 * 60 - 2 * H)
		// Topped up with the 30m depot on top of the 2h worked.
		assert.equal(summary.defaultBookingSec, 2 * H + 30 * 60)
	})
})
