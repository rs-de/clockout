import { nanoid } from "nanoid"

/** How dates/times are displayed. Optional so a document persisted before
 * this setting existed just keeps its original "auto" (browser-locale)
 * display instead of silently changing. */
export type DateFormat = "de" | "iso" | "auto"

export type TrackingSettings = {
	/** Minutes. Below this, worked time isn't yet banked to the depot (req #11). */
	dailyMinimum: number
	/** Minutes. The booking field can't exceed this; anything worked beyond it
	 * is banked to the depot too (req #11). */
	dailyMax: number
	dateFormat?: DateFormat
}

/**
 * One work session: a start and an end clock-time. `null` fields are
 * unfilled inputs, not zero timestamps — see `ensureTrailingBlock`, which
 * keeps the list always ending in one of these, ready for the next
 * start/stop.
 */
export type Block = {
	/** Unix timestamp in seconds. */
	start: number | null
	end: number | null
}

/**
 * A day-close snapshot (req #11): records the depot total *after* this
 * booking, not a delta — so the current depot is always just "the latest
 * entry", never a value that's separately stored and patched. Booking also
 * discards that day's block events, since they're now fully folded in here.
 */
export type Booking = {
	/** Unix timestamp in seconds, when the booking was made. */
	t: number
	/** The day's total worked time, before capping to `bookingSec`. */
	workedSec: number
	/** What was actually entered into the booking field — can exceed
	 * `workedSec` (topped up from the depot), but never `dailyMax`, and
	 * never more than the depot available at the time could cover. Whether
	 * (and how much) this booking drew down the depot is only ever
	 * knowable by comparing this to `workedSec`, never tracked separately. */
	bookingSec: number
	depotAfterSec: number
}

export type TrackingData = {
	/** Identifies this history document as a whole, e.g. as a server resource key. */
	id: string
	settings: TrackingSettings
	/** Today's in-progress, unbooked blocks — always ends with one empty
	 * block (see `ensureTrailingBlock`). */
	blocks: Block[]
	/** Append-only ledger of past bookings, oldest first. */
	bookings: Booking[]
}

export const DEFAULT_DAILY_MINIMUM = 7 * 60
export const DEFAULT_DAILY_MAX = 9 * 60 + 55
export const DEFAULT_DATE_FORMAT: DateFormat = "de"

/**
 * `id` can be supplied by the caller (e.g. one already generated to show in
 * a hidden `autocomplete="username"` field before the user ever submits, so
 * password managers key the saved password to the doc it actually belongs
 * to) instead of always minting a fresh one here.
 */
export function createTrackingData(
	settings: TrackingSettings = {
		dailyMinimum: DEFAULT_DAILY_MINIMUM,
		dailyMax: DEFAULT_DAILY_MAX,
		dateFormat: DEFAULT_DATE_FORMAT,
	},
	id: string = nanoid(),
): TrackingData {
	return { id, settings, blocks: [{ start: null, end: null }], bookings: [] }
}

/** Below this, a start/stop pair is discarded as an accidental tap (requirement #10). */
export const MIN_SESSION_SEC = 60

/**
 * A completed block shorter than MIN_SESSION_SEC is discarded back to empty
 * — as if the start never happened — rather than kept as a near-zero
 * session (requirement #10). Also catches an end typed before its start,
 * and an end with no start at all — the end field is never disabled while
 * start is empty (that was tried and reverted: a declarative `disabled`
 * derived from committed state fights the live-clock's once-a-second
 * re-render, which kept re-imposing it moments after a user's own typing
 * had just enabled the field), so this is the only guard against a stray
 * end-only block.
 */
function normalizeBlock(block: Block): Block {
	if (block.start === null && block.end !== null) {
		return { start: null, end: null }
	}
	if (
		block.start !== null &&
		block.end !== null &&
		block.end - block.start < MIN_SESSION_SEC
	) {
		return { start: null, end: null }
	}
	return block
}

/**
 * Completing a block (its end gets filled) automatically appends a new,
 * empty block after it (requirement #7) — this is what keeps that
 * invariant true after any edit, not just the Start/Stop buttons.
 *
 * Also collapses away any *other* fully-empty block first — e.g. an earlier
 * block manually cleared back to empty via the block-editing form
 * (app.tsx's applyBlockEdits) — rather than leaving a second, meaningless
 * empty row alongside the trailing one. An empty block conveys nothing on
 * its own, so there's never a reason to keep more than the one the
 * invariant already guarantees.
 */
function ensureTrailingBlock(blocks: Block[]): Block[] {
	const lastIndex = blocks.length - 1
	const collapsed = blocks.filter(
		(block, i) => block.start !== null || block.end !== null || i === lastIndex,
	)
	const last = collapsed.at(-1)
	if (!last || (last.start !== null && last.end !== null)) {
		return [...collapsed, { start: null, end: null }]
	}
	return collapsed
}

/** Sets one field of the block at `index` — the general primitive behind
 * the Start/Stop buttons. */
export function setBlockField(
	blocks: Block[],
	index: number,
	field: "start" | "end",
	value: number | null,
): Block[] {
	const updated = blocks.map((block, i) =>
		i === index ? normalizeBlock({ ...block, [field]: value }) : block,
	)
	return ensureTrailingBlock(updated)
}

/**
 * Applies a whole set of start/end edits at once — one entry per existing
 * block, in order — the primitive behind manually correcting a block's time
 * (requirement #7). A batch, not a per-field call like `setBlockField`,
 * because a native `<input type="time">` fires `change` the moment both its
 * segments hold *any* complete value, including one the user is still
 * mid-typing (e.g. typing "3" while heading for "30" reads as "03" first);
 * committing that immediately, one field at a time, would race the user's
 * next keystroke. Reading the whole form only once, at actual submit,
 * sidesteps that entirely. Each block's own normalize/discard rule
 * (requirement #10) still applies individually, and the trailing-empty-block
 * invariant is re-asserted once at the end, same as `setBlockField`.
 */
export function applyBlockEdits(
	blocks: Block[],
	edits: Array<{ start: number | null; end: number | null }>,
): Block[] {
	const updated = blocks.map((block, i) => normalizeBlock(edits[i] ?? block))
	return ensureTrailingBlock(updated)
}

/** Fills the trailing block's start with `nowSec`. No-op if it's already started. */
export function startBlock(blocks: Block[], nowSec: number): Block[] {
	const index = blocks.length - 1
	const last = blocks[index]
	if (!last || last.start !== null) return blocks
	return setBlockField(blocks, index, "start", nowSec)
}

/** Fills the trailing block's end with `nowSec`, closing it. No-op if it's
 * not currently open. */
export function stopBlock(blocks: Block[], nowSec: number): Block[] {
	const index = blocks.length - 1
	const last = blocks[index]
	if (!last || last.start === null || last.end !== null) return blocks
	return setBlockField(blocks, index, "end", nowSec)
}

/** True while the trailing block is open (started, not yet stopped). */
export function isRunning(blocks: Block[]): boolean {
	const last = blocks.at(-1)
	return last !== undefined && last.start !== null && last.end === null
}

/** A block's duration so far — an open block (no end yet) counts its
 * elapsed time live, up to `nowSec`. */
export function blockDurationSec(block: Block, nowSec: number): number {
	if (block.start === null) return 0
	return Math.max(0, (block.end ?? nowSec) - block.start)
}

/** Today's total worked time across all blocks, live. */
export function workedSec(blocks: Block[], nowSec: number): number {
	return blocks.reduce((sum, block) => sum + blockDurationSec(block, nowSec), 0)
}

/** The depot is always derived from the latest booking, never
 * stored-and-patched directly (requirement #9). */
export function depotSec(data: TrackingData): number {
	return data.bookings.at(-1)?.depotAfterSec ?? 0
}

/**
 * Clock time (Unix seconds) at which today's minimum is/was covered
 * (requirement #8): `now + dailyMin − depot − workedTime`. While a block is
 * running, `now` and `workedTime` advance together, so this stays fixed —
 * it only moves if tracking pauses (recedes) or the depot changes. May be
 * in the past, which just means the minimum is already covered.
 */
export function quittingTimeSec(data: TrackingData, nowSec: number): number {
	return (
		nowSec +
		data.settings.dailyMinimum * 60 -
		depotSec(data) -
		workedSec(data.blocks, nowSec)
	)
}

/**
 * The booking field's default: today's worked time, topped up with
 * available depot (if any) — e.g. leaving early on a short day, funded by
 * banked overtime — capped at the daily max. Never invents time from
 * nowhere: the top-up can't exceed what the depot actually holds.
 */
export function defaultBookingSec(data: TrackingData, nowSec: number): number {
	const worked = workedSec(data.blocks, nowSec)
	const depotAvailable = Math.max(0, depotSec(data))
	return Math.min(data.settings.dailyMax * 60, worked + depotAvailable)
}

/**
 * The depot math behind `bookDay`, factored out so the live booking-form
 * preview (app.tsx) can show what a booking *would* do without committing
 * it — same clamp, same delta, just not applied.
 *
 * `bookingSec` is clamped to `[0, min(workedSec + depotAvailable, dailyMax)]`
 * here — not just via the input's `min`/`max` — so a bypassed form
 * (devtools, a future regression) can't poison the depot with a value that
 * implies more was booked than was actually worked plus what the depot
 * could cover, or more than the configured max.
 *
 * `depotDelta` is simply `worked - clampedBookingSec`: worked time left
 * unbooked because it's over the daily max still banks, in full — but time
 * worked between the daily minimum and the daily max is booked as-is and
 * doesn't additionally bank (dailyMin has no part in this — it only shapes
 * the quitting-time estimate). Booking beyond `workedSec` tops the day up
 * from the depot instead of inventing time, drawing it down by exactly the
 * gap; the clamp above ensures that drawdown can never exceed what's
 * actually available.
 */
function bookingDelta(
	data: TrackingData,
	bookingSec: number,
	nowSec: number,
): { worked: number; clampedBookingSec: number; depotDelta: number } {
	const worked = workedSec(data.blocks, nowSec)
	const dailyMaxSec = data.settings.dailyMax * 60
	const depotAvailable = Math.max(0, depotSec(data))
	const clampedBookingSec = Math.min(
		Math.max(0, bookingSec),
		Math.min(worked + depotAvailable, dailyMaxSec),
	)
	const depotDelta = worked - clampedBookingSec
	return { worked, clampedBookingSec, depotDelta }
}

/** Closes out the current day (requirement #11). See `bookingDelta` for the
 * clamp/delta math. */
export function bookDay(
	data: TrackingData,
	bookingSec: number,
	nowSec: number,
): TrackingData {
	const { worked, clampedBookingSec, depotDelta } = bookingDelta(
		data,
		bookingSec,
		nowSec,
	)

	return {
		...data,
		blocks: [{ start: null, end: null }],
		bookings: [
			...data.bookings,
			{
				t: nowSec,
				workedSec: worked,
				bookingSec: clampedBookingSec,
				depotAfterSec: depotSec(data) + depotDelta,
			},
		],
	}
}

/** The depot balance that would result if `bookingSec` were booked right
 * now — for the booking form's live preview. Doesn't mutate anything. */
export function previewDepotAfterBooking(
	data: TrackingData,
	bookingSec: number,
	nowSec: number,
): number {
	return depotSec(data) + bookingDelta(data, bookingSec, nowSec).depotDelta
}

export type TrackingSummary = {
	isRunning: boolean
	workedSec: number
	depotSec: number
	quittingTimeSec: number
	defaultBookingSec: number
}

export function summarize(
	data: TrackingData,
	now: Date = new Date(),
): TrackingSummary {
	const nowSec = Math.floor(now.getTime() / 1000)
	const worked = workedSec(data.blocks, nowSec)
	const depot = depotSec(data)

	return {
		isRunning: isRunning(data.blocks),
		workedSec: worked,
		depotSec: depot,
		quittingTimeSec: nowSec + data.settings.dailyMinimum * 60 - depot - worked,
		defaultBookingSec: defaultBookingSec(data, nowSec),
	}
}

/** e.g. `-0h 15m` for 15 minutes over. */
export function formatDuration(totalSeconds: number): string {
	const sign = totalSeconds < 0 ? "-" : ""
	const abs = Math.round(Math.abs(totalSeconds))
	const h = Math.floor(abs / 3600)
	const m = Math.floor((abs % 3600) / 60)
	return `${sign}${h}h ${String(m).padStart(2, "0")}m`
}
