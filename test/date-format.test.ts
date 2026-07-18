import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
	formatClockTime,
	formatDayMonth,
	formatWeekdayName,
} from "../app/utils/date-format.ts"

// 2026-07-17 is a Friday.
const friday = new Date(2026, 6, 17, 9, 5)

describe("formatWeekdayName", () => {
	test("de: German weekday names", () => {
		assert.equal(formatWeekdayName(friday, "de", "long"), "Freitag")
		assert.equal(formatWeekdayName(friday, "de", "short"), "Fr")
	})

	test("iso: English weekday names", () => {
		assert.equal(formatWeekdayName(friday, "iso", "long"), "Friday")
		assert.equal(formatWeekdayName(friday, "iso", "short"), "Fri")
	})

	test("undefined falls back to the browser's own locale (same as auto)", () => {
		assert.equal(
			formatWeekdayName(friday, undefined, "long"),
			formatWeekdayName(friday, "auto", "long"),
		)
	})
})

describe("formatDayMonth", () => {
	test("de: DD.MM.", () => {
		assert.equal(formatDayMonth(friday, "de"), "17.07.")
	})

	test("iso: MM-DD", () => {
		assert.equal(formatDayMonth(friday, "iso"), "07-17")
	})
})

describe("formatClockTime", () => {
	test("de and iso both use 24h HH:mm", () => {
		const evening = new Date(2026, 6, 17, 21, 5)
		assert.equal(formatClockTime(evening, "de"), "21:05")
		assert.equal(formatClockTime(evening, "iso"), "21:05")
	})

	test("pads single-digit hours and minutes", () => {
		const earlyMorning = new Date(2026, 6, 17, 6, 5)
		assert.equal(formatClockTime(earlyMorning, "de"), "06:05")
	})
})
