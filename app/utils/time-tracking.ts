import { nanoid } from "nanoid"

export type TimeEventType = "start" | "stop"

export type TimeEvent = {
	/** Unix timestamp in seconds. */
	t: number
	type: TimeEventType
}

export type TrackingSettings = {
	weeklyTargetMin: number
	dailyMax: number
}

export type TrackingData = {
	/** Identifies this history document as a whole, e.g. as a server resource key. */
	id: string
	settings: TrackingSettings
	events: TimeEvent[]
}

export function createTrackingData(
	settings: TrackingSettings = {
		weeklyTargetMin: DEFAULT_WEEKLY_TARGET_MIN,
		dailyMax: DEFAULT_DAILY_MAX,
	},
): TrackingData {
	return { id: nanoid(), settings, events: [] }
}

export type TrackingSummary = {
	isRunning: boolean
	dailyWorkedSec: number
	dailyRemainingSec: number
	weeklyWorkedSec: number
	weeklyRemainingSec: number
}

export const DEFAULT_WEEKLY_TARGET_MIN = 35 * 60
export const DEFAULT_DAILY_MAX = 9 * 60 + 55

export function startOfDay(date: Date): Date {
	const d = new Date(date)
	d.setHours(0, 0, 0, 0)
	return d
}

/** Monday-based ISO week start. */
export function startOfWeek(date: Date): Date {
	const d = startOfDay(date)
	const daysSinceMonday = (d.getDay() + 6) % 7
	d.setDate(d.getDate() - daysSinceMonday)
	return d
}

function lastEvent(events: TimeEvent[]): TimeEvent | undefined {
	return [...events].sort((a, b) => a.t - b.t).at(-1)
}

export function isRunning(events: TimeEvent[]): boolean {
	return lastEvent(events)?.type === "start"
}

/** The trailing unmatched "start" event, if tracking is currently running. */
export function openStartEvent(events: TimeEvent[]): TimeEvent | null {
	const last = lastEvent(events)
	return last?.type === "start" ? last : null
}

/**
 * Calendar days (local, one entry per day) from the open start's day through
 * yesterday — the days requirement #9 asks the user to back-fill because the
 * "stop" was forgotten. Empty if tracking isn't running or started today.
 */
export function catchupDays(events: TimeEvent[], now: Date): Date[] {
	const open = openStartEvent(events)
	if (!open) return []

	const today = startOfDay(now)
	const days: Date[] = []
	let day = startOfDay(new Date(open.t * 1000))
	while (day.getTime() < today.getTime()) {
		days.push(day)
		day = new Date(day)
		day.setDate(day.getDate() + 1)
	}
	return days
}

/**
 * Backfills the forgotten days from requirement #9. `days` must be
 * `catchupDays(events, now)` and `workedMinutesPerDay` aligned to it. The
 * original start event (and its exact timestamp) is kept — only its missing
 * stop is added, at start + duration — while later days get a fresh
 * start/stop pair anchored at local midnight. Days entered as 0 get no
 * events.
 */
export function resolveCatchup(
	events: TimeEvent[],
	days: Date[],
	workedMinutesPerDay: number[],
): TimeEvent[] {
	const open = openStartEvent(events)
	if (!open || days.length === 0) return events

	const result = [...events]
	days.forEach((day, i) => {
		const minutes = workedMinutesPerDay[i] ?? 0
		if (i === 0) {
			result.push({ t: open.t + minutes * 60, type: "stop" })
		} else if (minutes > 0) {
			const dayStartSec = Math.floor(day.getTime() / 1000)
			result.push({ t: dayStartSec, type: "start" })
			result.push({ t: dayStartSec + minutes * 60, type: "stop" })
		}
	})
	return result
}

/**
 * Seconds worked within [rangeStart, rangeEnd), reconstructed from start/stop
 * events. A trailing unmatched start is treated as still running, clipped to `now`.
 */
export function workedSecondsInRange(
	events: TimeEvent[],
	rangeStart: Date,
	rangeEnd: Date,
	now: Date,
): number {
	const sorted = [...events].sort((a, b) => a.t - b.t)
	const rangeStartSec = Math.floor(rangeStart.getTime() / 1000)
	const rangeEndSec = Math.floor(rangeEnd.getTime() / 1000)
	const nowSec = Math.floor(now.getTime() / 1000)

	let total = 0
	let openStart: number | null = null

	for (const event of sorted) {
		if (event.type === "start") {
			openStart = event.t
		} else if (openStart !== null) {
			total += overlapSeconds(openStart, event.t, rangeStartSec, rangeEndSec)
			openStart = null
		}
	}

	if (openStart !== null) {
		total += overlapSeconds(openStart, nowSec, rangeStartSec, rangeEndSec)
	}

	return total
}

/** e.g. `-0h 15m` for 15 minutes over. */
export function formatDuration(totalSeconds: number): string {
	const sign = totalSeconds < 0 ? "-" : ""
	const abs = Math.round(Math.abs(totalSeconds))
	const h = Math.floor(abs / 3600)
	const m = Math.floor((abs % 3600) / 60)
	return `${sign}${h}h ${String(m).padStart(2, "0")}m`
}

function overlapSeconds(
	start: number,
	end: number,
	rangeStart: number,
	rangeEnd: number,
): number {
	const overlapStart = Math.max(start, rangeStart)
	const overlapEnd = Math.min(end, rangeEnd)
	return Math.max(0, overlapEnd - overlapStart)
}

export function summarize(
	data: TrackingData,
	now: Date = new Date(),
): TrackingSummary {
	const dayStart = startOfDay(now)
	const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
	const weekStart = startOfWeek(now)
	const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000)

	const dailyWorkedSec = workedSecondsInRange(
		data.events,
		dayStart,
		dayEnd,
		now,
	)
	const weeklyWorkedSec = workedSecondsInRange(
		data.events,
		weekStart,
		weekEnd,
		now,
	)

	return {
		isRunning: isRunning(data.events),
		dailyWorkedSec,
		dailyRemainingSec: data.settings.dailyMax * 60 - dailyWorkedSec,
		weeklyWorkedSec,
		weeklyRemainingSec: data.settings.weeklyTargetMin * 60 - weeklyWorkedSec,
	}
}
