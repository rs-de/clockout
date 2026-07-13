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
	/**
	 * Unix timestamp (seconds) of the most recent "start" event, whether that
	 * session is still running or has since stopped. `null` if there's no
	 * start event at all yet.
	 */
	startedAt: number | null
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

/** The most recent "start" event, whether that session is still running or has since stopped. */
function mostRecentStart(events: TimeEvent[]): TimeEvent | undefined {
	const sorted = [...events].sort((a, b) => a.t - b.t)
	for (let i = sorted.length - 1; i >= 0; i--) {
		const event = sorted[i]
		if (event?.type === "start") return event
	}
	return undefined
}

export function isRunning(events: TimeEvent[]): boolean {
	return lastEvent(events)?.type === "start"
}

/** Below this, a start/stop pair is discarded as an accidental tap (requirement #10). */
export const MIN_SESSION_SEC = 60

/**
 * Starts if stopped, stops if running. A stop within `MIN_SESSION_SEC` of
 * its matching start discards the pair entirely — as if the start never
 * happened — instead of recording a near-zero session.
 */
export function toggleTracking(
	events: TimeEvent[],
	nowSec: number,
): TimeEvent[] {
	const last = lastEvent(events)
	if (last?.type !== "start") {
		return [...events, { t: nowSec, type: "start" }]
	}
	if (nowSec - last.t < MIN_SESSION_SEC) {
		return events.filter((event) => event !== last)
	}
	return [...events, { t: nowSec, type: "stop" }]
}

/**
 * Calendar days (local, one entry per day) that requirement #9 asks the user
 * to back-fill because nothing was tracked for them: either an unfinished
 * open start's own day, or — if the last event is a clean stop — the days
 * after it with no events at all. Runs through yesterday; empty if the last
 * event is already from today (or there is no last event).
 */
export function catchupDays(events: TimeEvent[], now: Date): Date[] {
	const last = lastEvent(events)
	if (!last) return []

	const today = startOfDay(now)
	const lastDay = startOfDay(new Date(last.t * 1000))
	if (lastDay.getTime() >= today.getTime()) return []

	const days: Date[] = []
	let day = last.type === "start" ? lastDay : addDays(lastDay, 1)
	while (day.getTime() < today.getTime()) {
		days.push(day)
		day = addDays(day, 1)
	}
	return days
}

function addDays(day: Date, count: number): Date {
	const result = new Date(day)
	result.setDate(result.getDate() + count)
	return result
}

/**
 * Backfills the days from requirement #9. `days` must be
 * `catchupDays(events, now)` and `workedMinutesPerDay` aligned to it. If the
 * last event is a still-open start, its exact timestamp is kept and only its
 * missing stop is added (at start + duration) for `days[0]`; every other day
 * gets a fresh start/stop pair anchored at local midnight. Days entered as 0
 * get no events — except the last day in `days`, which always gets a
 * (possibly zero-duration) marker so a fresh `catchupDays` call afterwards
 * doesn't immediately re-open the same day.
 */
export function resolveCatchup(
	events: TimeEvent[],
	days: Date[],
	workedMinutesPerDay: number[],
): TimeEvent[] {
	if (days.length === 0) return events
	const last = lastEvent(events)
	if (!last) return events

	const preserveOpenStart = last.type === "start"
	const lastDayIndex = days.length - 1
	const result = [...events]
	days.forEach((day, i) => {
		const minutes = workedMinutesPerDay[i] ?? 0
		if (i === 0 && preserveOpenStart) {
			result.push({ t: last.t + minutes * 60, type: "stop" })
		} else if (minutes > 0 || i === lastDayIndex) {
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
		startedAt: mostRecentStart(data.events)?.t ?? null,
		dailyWorkedSec,
		dailyRemainingSec: data.settings.dailyMax * 60 - dailyWorkedSec,
		weeklyWorkedSec,
		weeklyRemainingSec: data.settings.weeklyTargetMin * 60 - weeklyWorkedSec,
	}
}
