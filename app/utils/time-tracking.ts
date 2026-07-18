import { nanoid } from "nanoid"

export type TimeEventType = "start" | "stop" | "skipDay"

export type TimeEvent = {
	/**
	 * Unix timestamp in seconds. For "skipDay" — an explicit "no work done
	 * this day" marker, e.g. from the catch-up form — this is that day's
	 * local midnight, not a real point-in-time event.
	 */
	t: number
	type: TimeEventType
}

/** How dates/times are displayed. Optional so a document persisted before
 * this setting existed just keeps its original "auto" (browser-locale)
 * display instead of silently changing. */
export type DateFormat = "de" | "iso" | "auto"

export type TrackingSettings = {
	weeklyTargetMin: number
	dailyMax: number
	dateFormat?: DateFormat
}

export type TrackingData = {
	/** Identifies this history document as a whole, e.g. as a server resource key. */
	id: string
	settings: TrackingSettings
	events: TimeEvent[]
}

export const DEFAULT_DATE_FORMAT: DateFormat = "de"

export function createTrackingData(
	settings: TrackingSettings = {
		weeklyTargetMin: DEFAULT_WEEKLY_TARGET_MIN,
		dailyMax: DEFAULT_DAILY_MAX,
		dateFormat: DEFAULT_DATE_FORMAT,
	},
): TrackingData {
	return { id: nanoid(), settings, events: [] }
}

export type TrackingSummary = {
	isRunning: boolean
	/**
	 * Unix timestamp (seconds) of today's first "start" event — fixed for
	 * the day regardless of later stop/restart cycles. `null` if nothing
	 * has started yet today.
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

/**
 * The first "start" event of `now`'s calendar day, if any — stays fixed
 * across a lunch-break-style stop/restart instead of jumping to whichever
 * start happened most recently.
 */
function firstStartToday(
	events: TimeEvent[],
	now: Date,
): TimeEvent | undefined {
	const today = startOfDay(now).getTime()
	return [...events]
		.sort((a, b) => a.t - b.t)
		.find(
			(event) =>
				event.type === "start" &&
				startOfDay(new Date(event.t * 1000)).getTime() === today,
		)
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

/**
 * Every day of the current week (Monday..yesterday) that needs explicit
 * backfilling: the classic gap from `catchupDays`, plus any other day this
 * week with no events overlapping it at all — e.g. a Monday before the very
 * first thing ever tracked, which `catchupDays` alone wouldn't catch since
 * it only looks forward from the last event. Always chronological, so
 * `resolveCatchup`'s day-identity matching lines up. Empty for a document
 * with no events yet at all — a brand-new setup shouldn't immediately
 * demand backfilling days nobody has touched yet.
 */
export function weeklyEntryDays(events: TimeEvent[], now: Date): Date[] {
	if (events.length === 0) return []

	const gapDays = catchupDays(events, now)
	const gapDaySet = new Set(gapDays.map((day) => day.getTime()))

	const today = startOfDay(now)
	const blankDays: Date[] = []
	for (
		let day = startOfWeek(now);
		day.getTime() < today.getTime();
		day = addDays(day, 1)
	) {
		if (gapDaySet.has(day.getTime())) continue
		const dayEnd = addDays(day, 1)
		const workedSec = workedSecondsInRange(events, day, dayEnd, now)
		const hasSkipMarker = events.some(
			(event) =>
				event.type === "skipDay" &&
				startOfDay(new Date(event.t * 1000)).getTime() === day.getTime(),
		)
		if (workedSec === 0 && !hasSkipMarker) blankDays.push(day)
	}

	return [...gapDays, ...blankDays].sort((a, b) => a.getTime() - b.getTime())
}

function addDays(day: Date, count: number): Date {
	const result = new Date(day)
	result.setDate(result.getDate() + count)
	return result
}

export type RelativeEvent = {
	/** Calendar days before `now`'s day; 0 = today. */
	daysAgo: number
	/** Local time-of-day, 24h "HH:MM". */
	time: string
	type: TimeEventType
}

/**
 * Resolves offset-based event descriptors (e.g. "3 days ago at 22:00") into
 * concrete Unix timestamps relative to `now`. Used for demo examples and
 * QA fixtures that need to stay valid no matter when they're loaded, unlike
 * a snapshot of absolute timestamps, which goes stale the moment "today"
 * moves on.
 */
export function resolveRelativeEvents(
	relativeEvents: RelativeEvent[],
	now: Date,
): TimeEvent[] {
	return relativeEvents.map(({ daysAgo, time, type }) => {
		const [hours, minutes] = time.split(":").map(Number)
		const day = addDays(startOfDay(now), -daysAgo)
		day.setHours(hours ?? 0, minutes ?? 0, 0, 0)
		return { t: Math.floor(day.getTime() / 1000), type }
	})
}

/**
 * Backfills the days from requirement #9. `days` must be
 * `weeklyEntryDays(events, now)` (or `catchupDays`) and `workedMinutesPerDay`
 * aligned to it, in chronological order. If the last event is a still-open
 * start, whichever entry in `days` matches *that start's own calendar day*
 * keeps its exact timestamp and only gets its missing stop added (at start +
 * duration) — even if 0 minutes, since that dangling start must be closed
 * somehow regardless. Matching by date rather than always assuming index 0
 * means an earlier, otherwise-untouched day (e.g. a Monday before the very
 * first thing ever tracked) can safely appear before it in `days`. Every
 * other day with minutes > 0 gets a fresh start/stop pair, anchored at local
 * midnight *or* right after the previous day's session ends, whichever is
 * later — so a day entered with enough hours to run past midnight (e.g. a
 * forgotten start at 08:00 plus 20h) still credits its full duration instead
 * of getting clamped, and the next day's session is chained after it instead
 * of overlapping it (see the regression test: a naive midnight anchor would
 * make the two sessions interleave, which breaks workedSecondsInRange's
 * single-open-start assumption and silently discards most of both days'
 * hours). Every other day entered as 0 gets an explicit "skipDay" marker
 * instead, so "no work today" is recorded unambiguously and a fresh
 * `weeklyEntryDays` call afterwards never re-opens it.
 */
export function resolveCatchup(
	events: TimeEvent[],
	days: Date[],
	workedMinutesPerDay: number[],
): TimeEvent[] {
	if (days.length === 0) return events
	const last = lastEvent(events)
	if (!last) return events

	const openStartDay =
		last.type === "start" ? startOfDay(new Date(last.t * 1000)).getTime() : null
	const result = [...events]
	let cursorSec: number | null = null // earliest the next session may start

	days.forEach((day, i) => {
		const minutes = workedMinutesPerDay[i] ?? 0
		const dayStartSec = Math.floor(day.getTime() / 1000)

		if (openStartDay !== null && day.getTime() === openStartDay) {
			const stopSec = last.t + minutes * 60
			result.push({ t: stopSec, type: "stop" })
			cursorSec = stopSec
			return
		}

		if (minutes > 0) {
			const startSec =
				cursorSec !== null ? Math.max(cursorSec, dayStartSec) : dayStartSec
			const stopSec = startSec + minutes * 60
			result.push({ t: startSec, type: "start" })
			result.push({ t: stopSec, type: "stop" })
			cursorSec = stopSec
		} else {
			result.push({ t: dayStartSec, type: "skipDay" })
		}
	})
	return result
}

/**
 * Seconds worked within [rangeStart, rangeEnd), reconstructed from start/stop
 * events. A trailing unmatched start is treated as still running, clipped to
 * `now`. "skipDay" markers are pure no-ops here — they neither open nor
 * close a session — so they can never disrupt a real session that happens
 * to overlap one chronologically (e.g. a chained catch-up session spilling
 * into a day the user separately marked as skipped).
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
		} else if (event.type === "stop" && openStart !== null) {
			total += overlapSeconds(openStart, event.t, rangeStartSec, rangeEndSec)
			openStart = null
		}
	}

	if (openStart !== null) {
		total += overlapSeconds(openStart, nowSec, rangeStartSec, rangeEndSec)
	}

	return total
}

export type DailyBreakdownEntry = {
	day: Date
	workedSec: number
}

/**
 * Per-day worked seconds for every day of `now`'s week (Monday..Sunday),
 * so the numbers behind "Week remaining" are always visible and checkable
 * rather than a black-box total.
 */
export function weeklyBreakdown(
	events: TimeEvent[],
	now: Date,
): DailyBreakdownEntry[] {
	const weekStart = startOfWeek(now)
	return Array.from({ length: 7 }, (_, i) => {
		const day = addDays(weekStart, i)
		const dayEnd = addDays(day, 1)
		const workedSec =
			workedSecondsInRange(events, day, dayEnd, now) -
			staleOpenSessionOverlap(events, now, day, dayEnd)
		return { day, workedSec }
	})
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

/**
 * How much of `rangeStart..rangeEnd` is covered by a still-open session that
 * began on an earlier calendar day than `now` — a forgotten stop bleeding
 * forward, not real same-day progress. 0 once there's no open session, or
 * the open session actually started today (that *is* live, real work).
 */
function staleOpenSessionOverlap(
	events: TimeEvent[],
	now: Date,
	rangeStart: Date,
	rangeEnd: Date,
): number {
	const last = lastEvent(events)
	if (last?.type !== "start") return 0

	const today = startOfDay(now)
	const openStartDay = startOfDay(new Date(last.t * 1000))
	if (openStartDay.getTime() >= today.getTime()) return 0

	return overlapSeconds(
		last.t,
		Math.floor(now.getTime() / 1000),
		Math.floor(rangeStart.getTime() / 1000),
		Math.floor(rangeEnd.getTime() / 1000),
	)
}

export function summarize(
	data: TrackingData,
	now: Date = new Date(),
): TrackingSummary {
	const dayStart = startOfDay(now)
	const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
	const weekStart = startOfWeek(now)
	const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000)

	// A still-open session that began before today (e.g. a forgotten stop
	// from days ago) already renders as blank catch-up input fields rather
	// than a number for its own past days — so its raw, uncorrected elapsed
	// time shouldn't leak into today's or the week's totals either. Excluded
	// here, then added back in for real once the user resolves it via the
	// catch-up form (or, for today, by actually pressing Start).
	const dailyWorkedSec =
		workedSecondsInRange(data.events, dayStart, dayEnd, now) -
		staleOpenSessionOverlap(data.events, now, dayStart, dayEnd)
	const weeklyWorkedSec =
		workedSecondsInRange(data.events, weekStart, weekEnd, now) -
		staleOpenSessionOverlap(data.events, now, weekStart, weekEnd)

	const rawDailyRemainingSec = data.settings.dailyMax * 60 - dailyWorkedSec
	const weeklyRemainingSec =
		data.settings.weeklyTargetMin * 60 - weeklyWorkedSec
	// Once the week's target is already met, don't imply there's still a
	// full day's budget left today — floor at 0. A day that's already gone
	// over on its own stays negative, though; that's real overage, not the
	// "week is already done" case this floor is for.
	const dailyRemainingSec =
		weeklyRemainingSec <= 0
			? Math.min(rawDailyRemainingSec, 0)
			: rawDailyRemainingSec

	return {
		isRunning: isRunning(data.events),
		startedAt: firstStartToday(data.events, now)?.t ?? null,
		dailyWorkedSec,
		dailyRemainingSec,
		weeklyWorkedSec,
		weeklyRemainingSec,
	}
}
