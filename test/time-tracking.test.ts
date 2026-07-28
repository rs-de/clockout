import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
	blockDurationSec,
	bookDay,
	createTrackingData,
	DEFAULT_DAILY_MAX,
	DEFAULT_DAILY_MINIMUM,
	defaultBookingSec,
	depotSec,
	feierabendSec,
	formatDuration,
	isRunning,
	MIN_SESSION_SEC,
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
		assert.deepEqual(a.buchungen, [])
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
			buchungen: [
				{ t: 0, workedSec: 8 * H, bookingSec: 8 * H, depotAfterSec: 1 * H },
				{ t: 1, workedSec: 8 * H, bookingSec: 8 * H, depotAfterSec: 2 * H },
			],
		}
		assert.equal(depotSec(data), 2 * H)
	})
})

describe("feierabendSec", () => {
	test("now + dailyMin when nothing worked and no depot", () => {
		const data = createTrackingData(settings())
		assert.equal(feierabendSec(data, 0), 7 * H)
	})

	test("an existing depot pulls it earlier", () => {
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: null, end: null }],
			buchungen: [{ t: 0, workedSec: 0, bookingSec: 0, depotAfterSec: 1 * H }],
		}
		assert.equal(feierabendSec(data, 0), 6 * H)
	})

	test("stays fixed while a block is running, as `now` advances", () => {
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 9 * H, end: null }],
			buchungen: [],
		}
		assert.equal(feierabendSec(data, 10 * H), feierabendSec(data, 11 * H))
	})

	test("recedes once tracking pauses (now advances, worked time doesn't)", () => {
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 9 * H, end: 10 * H }],
			buchungen: [],
		}
		assert.ok(feierabendSec(data, 11 * H) > feierabendSec(data, 10 * H))
	})

	test("can land in the past once the minimum is already covered", () => {
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: 8 * H }],
			buchungen: [],
		}
		assert.ok(feierabendSec(data, 9 * H) < 9 * H)
	})
})

describe("defaultBookingSec", () => {
	test("equals worked time when under the daily max", () => {
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: 8 * H }],
			buchungen: [],
		}
		assert.equal(defaultBookingSec(data, 8 * H), 8 * H)
	})

	test("caps at the daily max once worked time exceeds it", () => {
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: 11 * H }],
			buchungen: [],
		}
		assert.equal(defaultBookingSec(data, 11 * H), (9 * 60 + 55) * 60)
	})
})

describe("bookDay", () => {
	test("a day under the minimum banks nothing", () => {
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: 5 * H }],
			buchungen: [],
		}
		const booked = bookDay(data, defaultBookingSec(data, 5 * H), 5 * H)
		assert.equal(depotSec(booked), 0)
	})

	test("a day over the minimum (but under the max) banks the surplus", () => {
		const worked = 8.5 * H
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: worked }],
			buchungen: [],
		}
		const booked = bookDay(data, defaultBookingSec(data, worked), worked)
		assert.equal(depotSec(booked), 1.5 * H)
	})

	test("a day over the max banks worked-minus-minimum, split across both terms", () => {
		const worked = 11 * H
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: worked }],
			buchungen: [],
		}
		const booked = bookDay(data, defaultBookingSec(data, worked), worked)
		assert.equal(depotSec(booked), worked - 7 * H)
	})

	test("banks the same total regardless of the exact bookingSec, as long as it's >= dailyMin", () => {
		const worked = 8 * H
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: worked }],
			buchungen: [],
		}
		const bookedDefault = bookDay(data, worked, worked)
		const bookedLower = bookDay(data, 7.5 * H, worked)
		assert.equal(depotSec(bookedDefault), 1 * H)
		assert.equal(depotSec(bookedLower), 1 * H)
	})

	test("booking below the minimum still banks the un-booked remainder in full", () => {
		const worked = 8 * H
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: worked }],
			buchungen: [],
		}
		// Booked only 6h (below the 7h minimum) out of 8h worked: the credit
		// term is floored at 0, but the un-booked 2h is still banked in full.
		const booked = bookDay(data, 6 * H, worked)
		assert.equal(depotSec(booked), 2 * H)
	})

	test("clamps a bookingSec above what was actually worked", () => {
		const worked = 3 * H
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: worked }],
			buchungen: [],
		}
		const booked = bookDay(data, 100 * H, worked)
		assert.equal(booked.buchungen.at(-1)?.bookingSec, worked)
	})

	test("clamps a bookingSec above the daily max", () => {
		const worked = 11 * H
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: worked }],
			buchungen: [],
		}
		const booked = bookDay(data, 100 * H, worked)
		assert.equal(booked.buchungen.at(-1)?.bookingSec, (9 * 60 + 55) * 60)
	})

	test("clamps a negative bookingSec up to 0", () => {
		const worked = 8 * H
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: worked }],
			buchungen: [],
		}
		const booked = bookDay(data, -100, worked)
		assert.equal(booked.buchungen.at(-1)?.bookingSec, 0)
		assert.equal(depotSec(booked), worked)
	})

	test("resets blocks to a single empty one and appends to the ledger", () => {
		const worked = 8 * H
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: worked }],
			buchungen: [{ t: -1, workedSec: 1 * H, bookingSec: 1 * H, depotAfterSec: 5 * 60 }],
		}
		const booked = bookDay(data, worked, worked)

		assert.deepEqual(booked.blocks, [{ start: null, end: null }])
		assert.equal(booked.buchungen.length, 2)
		assert.equal(booked.buchungen[0]?.depotAfterSec, 5 * 60)
		assert.equal(depotSec(booked), 5 * 60 + (worked - 7 * H))
	})
})

describe("summarize", () => {
	test("bundles the running state, worked/depot time, and Feierabend consistently", () => {
		const data: TrackingData = {
			id: "test",
			settings: settings(),
			blocks: [{ start: 0, end: null }],
			buchungen: [{ t: -1, workedSec: 1 * H, bookingSec: 1 * H, depotAfterSec: 30 * 60 }],
		}
		const now = 2 * H
		const summary = summarize(data, new Date(now * 1000))

		assert.equal(summary.isRunning, true)
		assert.equal(summary.workedSec, 2 * H)
		assert.equal(summary.depotSec, 30 * 60)
		assert.equal(summary.feierabendSec, now + 7 * H - 30 * 60 - 2 * H)
		assert.equal(summary.defaultBookingSec, 2 * H)
	})
})
