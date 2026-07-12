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

export function isRunning(events: TimeEvent[]): boolean {
	if (events.length === 0) return false
	const last = [...events].sort((a, b) => a.t - b.t).at(-1)
	return last?.type === "start"
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
