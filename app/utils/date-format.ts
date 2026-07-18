import type { DateFormat } from "./time-tracking.ts"

function pad2(n: number): string {
	return String(n).padStart(2, "0")
}

const WEEKDAY_LONG_DE = [
	"Montag",
	"Dienstag",
	"Mittwoch",
	"Donnerstag",
	"Freitag",
	"Samstag",
	"Sonntag",
]
const WEEKDAY_SHORT_DE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
const WEEKDAY_LONG_EN = [
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
	"Sunday",
]
const WEEKDAY_SHORT_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

/** Monday-first, matching `startOfWeek`. */
function weekdayIndex(date: Date): number {
	return (date.getDay() + 6) % 7
}

/**
 * `dateFormat` is optional so a document persisted before this setting
 * existed (no `dateFormat` in its stored settings) falls through to the
 * same "auto" behavior it always had, rather than silently changing.
 */
export function formatWeekdayName(
	date: Date,
	dateFormat: DateFormat | undefined,
	style: "long" | "short",
): string {
	if (dateFormat === "de") {
		return (style === "long" ? WEEKDAY_LONG_DE : WEEKDAY_SHORT_DE)[
			weekdayIndex(date)
		] as string
	}
	if (dateFormat === "iso") {
		return (style === "long" ? WEEKDAY_LONG_EN : WEEKDAY_SHORT_EN)[
			weekdayIndex(date)
		] as string
	}
	return date.toLocaleDateString(undefined, { weekday: style })
}

/** Day + month, no year — e.g. `17.07.` (de), `07-17` (iso), or the browser's own order (auto). */
export function formatDayMonth(
	date: Date,
	dateFormat: DateFormat | undefined,
): string {
	const day = pad2(date.getDate())
	const month = pad2(date.getMonth() + 1)
	if (dateFormat === "de") return `${day}.${month}.`
	if (dateFormat === "iso") return `${month}-${day}`
	return date.toLocaleDateString(undefined, {
		day: "2-digit",
		month: "2-digit",
	})
}

/** 24h `HH:mm` for de/iso, the browser's own clock convention for auto. */
export function formatClockTime(
	date: Date,
	dateFormat: DateFormat | undefined,
): string {
	if (dateFormat === "de" || dateFormat === "iso") {
		return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
	}
	return date.toLocaleTimeString(undefined, {
		hour: "2-digit",
		minute: "2-digit",
	})
}
