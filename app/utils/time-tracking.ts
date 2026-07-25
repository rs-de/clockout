import { nanoid } from "nanoid"

export type TimeEventType = "start" | "stop" | "skipDay" | "adjust"

export type TimeEvent = {
	/**
	 * Unix timestamp in seconds. For "skipDay" and "adjust" — which aren't
	 * real points in time — this is that day's local midnight instead.
	 */
	t: number
	type: TimeEventType
	/**
	 * Only meaningful for "adjust": a signed minutes delta layered on top of
	 * that day's real start/stop history (see `editDay`) — positive to add,
	 * negative to subtract. Never touches the original events, so it folds
	 * into daily *and* weekly totals automatically via
	 * `workedSecondsInRange`, regardless of how many pairs (or none) already
	 * cover that day.
	 */
	minutes?: number
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

/**
 * `id` can be supplied by the caller (e.g. one already generated to show in
 * a hidden `autocomplete="username"` field before the user ever submits, so
 * password managers key the saved password to the doc it actually belongs
 * to) instead of always minting a fresh one here.
 */
export function createTrackingData(
	settings: TrackingSettings = {
		weeklyTargetMin: DEFAULT_WEEKLY_TARGET_MIN,
		dailyMax: DEFAULT_DAILY_MAX,
		dateFormat: DEFAULT_DATE_FORMAT,
	},
	id: string = nanoid(),
): TrackingData {
	return { id, settings, events: [] }
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
 * The still-open "start" event, if any — found by walking events
 * chronologically and pairing start/stop, ignoring "skipDay" markers
 * (already defined to be pure no-ops for session purposes, see
 * `workedSecondsInRange`). Unlike checking whether the single most-recent
 * event is a "start", this keeps finding a dangling start even after a
 * later day gets its own skipDay marker from a partial catch-up save — so
 * an earlier, still-unresolved day doesn't go invisible just because
 * something after it, chronologically, got resolved first.
 */
function danglingStart(events: TimeEvent[]): TimeEvent | undefined {
	let open: TimeEvent | undefined
	for (const event of [...events].sort((a, b) => a.t - b.t)) {
		if (event.type === "start") open = event
		else if (event.type === "stop") open = undefined
	}
	return open
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
	return danglingStart(events) !== undefined
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
 * event is already from today (or there is no last event). Always includes
 * a still-open start's own day even if it's no longer the most recent event
 * overall — e.g. after a partial catch-up save records a skipDay marker for
 * a later day while the dangling start itself is left unanswered, it must
 * keep demanding an answer rather than going invisible just because
 * something after it, chronologically, got resolved first.
 */
export function catchupDays(events: TimeEvent[], now: Date): Date[] {
	const last = lastEvent(events)
	if (!last) return []

	const today = startOfDay(now)
	const lastDay = startOfDay(new Date(last.t * 1000))

	const days: Date[] = []
	if (lastDay.getTime() < today.getTime()) {
		let day = last.type === "start" ? lastDay : addDays(lastDay, 1)
		while (day.getTime() < today.getTime()) {
			if (weekendNeedsAttention(events, day)) days.push(day)
			day = addDays(day, 1)
		}
	}

	const dangling = danglingStart(events)
	if (dangling) {
		const danglingDay = startOfDay(new Date(dangling.t * 1000))
		if (
			danglingDay.getTime() < today.getTime() &&
			!days.some((day) => day.getTime() === danglingDay.getTime())
		) {
			days.unshift(danglingDay)
		}
	}

	return days.sort((a, b) => a.getTime() - b.getTime())
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
		if (!weekendNeedsAttention(events, day)) continue
		const dayEnd = addDays(day, 1)
		const workedSec =
			workedSecondsInRange(events, day, dayEnd, now) -
			staleOpenSessionOverlap(events, now, day, dayEnd)
		const hasOwnDayEvent = events.some(
			(event) =>
				startOfDay(new Date(event.t * 1000)).getTime() === day.getTime(),
		)
		if (workedSec === 0 && !hasOwnDayEvent) blankDays.push(day)
	}

	return [...gapDays, ...blankDays].sort((a, b) => a.getTime() - b.getTime())
}

function addDays(day: Date, count: number): Date {
	const result = new Date(day)
	result.setDate(result.getDate() + count)
	return result
}

/**
 * Whether `day` still needs its own catch-up entry / display row. Always
 * true for a weekday. For a Saturday or Sunday, only true if that weekend's
 * own Friday has no "stop" or "skipDay" of its own — typically nothing is
 * worked over a weekend, so by default neither day is demanded or shown; a
 * Friday left dangling (forgotten stop) can bleed real hours into the
 * weekend, so that's the one case it still needs surfacing.
 */
function weekendNeedsAttention(events: TimeEvent[], day: Date): boolean {
	const dow = day.getDay()
	if (dow !== 0 && dow !== 6) return true

	const friday = addDays(day, dow === 6 ? -1 : -2)
	const fridayResolved = events.some(
		(event) =>
			(event.type === "stop" || event.type === "skipDay") &&
			startOfDay(new Date(event.t * 1000)).getTime() === friday.getTime(),
	)
	return !fridayResolved
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
 * `weeklyEntryDays(events, now)` (or `catchupDays`), with
 * `workedMinutesPerDay` and `skipDayFlags` aligned to it, in chronological
 * order.
 *
 * Every day — including a still-open start's own day — is resolved only if
 * it's actually answered (real minutes, or the skip flag). An unanswered
 * day (0 minutes, no skip) is left completely untouched, so it stays
 * pending for a later save instead of being silently recorded as "no work"
 * just because it shares a form with days that were answered. This applies
 * uniformly, including the dangling start's own day, so a user who only
 * means to answer a later day (e.g. checking "no work" for Wednesday) can
 * leave an earlier, still-unresolved day (e.g. a session forgotten open
 * since Tuesday) for a later save.
 *
 * The one exception: if a *later* day is given real minutes while the
 * dangling start's own day is still unanswered, the dangling start gets
 * closed first (0 duration, at its exact original timestamp) before that
 * later day's fresh session opens — otherwise the two sessions would
 * collide (the later "start" would silently become "the" open session in
 * any single-open-start bookkeeping, orphaning the original dangling event
 * with no stop, ever). A "no work" skip flag on a later day never triggers
 * this, since a skipDay marker is a pure no-op that can't collide with
 * anything.
 *
 * Whichever day actually closes the dangling start — whether answered
 * directly or force-closed by a later real day — keeps its exact original
 * timestamp, and only gets its missing stop added.
 *
 * Every other answered day with minutes > 0 gets a fresh start/stop pair,
 * anchored at local midnight *or* right after the previous day's session
 * ends, whichever is later — so a day entered with enough hours to run past
 * midnight (e.g. a forgotten start at 08:00 plus 20h) still credits its
 * full duration instead of getting clamped, and the next day's session is
 * chained after it instead of overlapping it (see the regression test: a
 * naive midnight anchor would make the two sessions interleave, which
 * breaks workedSecondsInRange's single-open-start assumption and silently
 * discards most of both days' hours). Every other answered day with 0
 * minutes gets an explicit "skipDay" marker instead, so "no work today" is
 * recorded unambiguously and a fresh `weeklyEntryDays` call afterwards
 * never re-opens it.
 */
export function resolveCatchup(
	events: TimeEvent[],
	days: Date[],
	workedMinutesPerDay: number[],
	skipDayFlags: boolean[],
): TimeEvent[] {
	if (days.length === 0) return events

	const dangling = danglingStart(events)
	const danglingDayTime = dangling
		? startOfDay(new Date(dangling.t * 1000)).getTime()
		: undefined
	let danglingClosed = false
	const result = [...events]
	let cursorSec: number | null = null // earliest the next session may start

	days.forEach((day, i) => {
		const minutes = workedMinutesPerDay[i] ?? 0
		const skip = skipDayFlags[i] ?? false
		const dayStartSec = Math.floor(day.getTime() / 1000)

		if (dangling && day.getTime() === danglingDayTime) {
			if (minutes > 0 || skip) {
				const stopSec = dangling.t + minutes * 60
				result.push({ t: stopSec, type: "stop" })
				cursorSec = stopSec
				danglingClosed = true
			}
			return
		}

		if (minutes > 0) {
			if (dangling && !danglingClosed) {
				result.push({ t: dangling.t, type: "stop" })
				cursorSec = dangling.t
				danglingClosed = true
			}
			const startSec =
				cursorSec !== null ? Math.max(cursorSec, dayStartSec) : dayStartSec
			const stopSec = startSec + minutes * 60
			result.push({ t: startSec, type: "start" })
			result.push({ t: stopSec, type: "stop" })
			cursorSec = stopSec
		} else if (skip) {
			result.push({ t: dayStartSec, type: "skipDay" })
		}
	})
	return result
}

/**
 * Manually corrects an already-recorded day's total from the weekly
 * breakdown — unlike `resolveCatchup`, which only fills in a *blank* day.
 * Never touches the real start/stop history: appends a single signed
 * "adjust" event for the difference between the entered total and
 * `currentWorkedSec` (that day's total the caller already has, e.g. from
 * `weeklyBreakdown` — recomputing it here would risk drifting out of sync
 * with what the UI actually showed the user). A day with nothing to adjust
 * (the entered value already matches) appends nothing.
 */
export function editDay(
	events: TimeEvent[],
	day: Date,
	minutes: number,
	currentWorkedSec: number,
): TimeEvent[] {
	const deltaMinutes = minutes - Math.round(currentWorkedSec / 60)
	if (deltaMinutes === 0) return events
	return [
		...events,
		{
			t: Math.floor(day.getTime() / 1000),
			type: "adjust",
			minutes: deltaMinutes,
		},
	]
}

/**
 * Seconds worked within [rangeStart, rangeEnd), reconstructed from start/stop
 * events. A trailing unmatched start is treated as still running, clipped to
 * `now`. "skipDay" markers are pure no-ops here — they neither open nor
 * close a session — so they can never disrupt a real session that happens
 * to overlap one chronologically (e.g. a chained catch-up session spilling
 * into a day the user separately marked as skipped). "adjust" events (see
 * `editDay`) add their signed minutes directly whenever their own timestamp
 * falls in range — this is what makes a manual correction fold into both
 * that day's and that week's totals automatically, with no special-casing
 * needed at either call site.
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
		} else if (
			event.type === "adjust" &&
			event.t >= rangeStartSec &&
			event.t < rangeEndSec
		) {
			total += (event.minutes ?? 0) * 60
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
 * Every day this week worth showing: Monday..Friday always, plus this
 * week's weekend once `now` itself has reached it (Saturday shows once
 * `now` is Saturday, Sunday once `now` is Sunday), plus any older pending
 * catch-up day carried over from before this week (e.g. last Friday plus
 * the weekend it bled into, if Friday was never stopped) so it stays
 * reachable instead of falling off the display once a new week starts.
 */
function visibleWeekDays(events: TimeEvent[], now: Date): Date[] {
	const weekStart = startOfWeek(now)
	const days = Array.from({ length: 5 }, (_, i) => addDays(weekStart, i))

	const dow = now.getDay()
	if (dow === 0 || dow === 6) days.push(addDays(weekStart, 5))
	if (dow === 0) days.push(addDays(weekStart, 6))

	const known = new Set(days.map((day) => day.getTime()))
	for (const day of weeklyEntryDays(events, now)) {
		if (day.getTime() < weekStart.getTime() && !known.has(day.getTime())) {
			days.push(day)
			known.add(day.getTime())
		}
	}

	return days.sort((a, b) => a.getTime() - b.getTime())
}

/**
 * Per-day worked seconds for every day `visibleWeekDays` returns, so the
 * numbers behind "Week remaining" are always visible and checkable rather
 * than a black-box total.
 */
export function weeklyBreakdown(
	events: TimeEvent[],
	now: Date,
): DailyBreakdownEntry[] {
	return visibleWeekDays(events, now).map((day) => {
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
	const dangling = danglingStart(events)
	if (!dangling) return 0

	const today = startOfDay(now)
	const openStartDay = startOfDay(new Date(dangling.t * 1000))
	if (openStartDay.getTime() >= today.getTime()) return 0

	return overlapSeconds(
		dangling.t,
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
