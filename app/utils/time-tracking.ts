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
export type Buchung = {
	/** Unix timestamp in seconds, when the booking was made. */
	t: number
	/** The day's total worked time, before capping to `bookingSec`. */
	workedSec: number
	/** What was actually entered into the booking field (<= dailyMax). */
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
	buchungen: Buchung[]
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
	return { id, settings, blocks: [{ start: null, end: null }], buchungen: [] }
}

/** Below this, a start/stop pair is discarded as an accidental tap (requirement #10). */
export const MIN_SESSION_SEC = 60

/**
 * A completed block shorter than MIN_SESSION_SEC is discarded back to empty
 * — as if the start never happened — rather than kept as a near-zero
 * session (requirement #10). Also catches an end typed before its start.
 */
function normalizeBlock(block: Block): Block {
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
 */
function ensureTrailingBlock(blocks: Block[]): Block[] {
	const last = blocks.at(-1)
	if (!last || (last.start !== null && last.end !== null)) {
		return [...blocks, { start: null, end: null }]
	}
	return blocks
}

/** Sets one field of the block at `index` — the general primitive behind
 * both the Start/Stop buttons and manual correction of a block's time. */
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
	return data.buchungen.at(-1)?.depotAfterSec ?? 0
}

/**
 * Clock time (Unix seconds) at which today's minimum is/was covered
 * (requirement #8): `now + dailyMin − depot − workedTime`. While a block is
 * running, `now` and `workedTime` advance together, so this stays fixed —
 * it only moves if tracking pauses (recedes) or the depot changes. May be
 * in the past, which just means the minimum is already covered.
 */
export function feierabendSec(data: TrackingData, nowSec: number): number {
	return (
		nowSec +
		data.settings.dailyMinimum * 60 -
		depotSec(data) -
		workedSec(data.blocks, nowSec)
	)
}

/** The booking field's default: today's worked time, capped at the daily max. */
export function defaultBookingSec(data: TrackingData, nowSec: number): number {
	return Math.min(workedSec(data.blocks, nowSec), data.settings.dailyMax * 60)
}

/**
 * Closes out the current day (requirement #11). `bookingSec` is clamped to
 * `[0, min(workedTime, dailyMax)]` here too — not just via the input's
 * `min`/`max` — so a bypassed form (devtools, a future regression) can't
 * poison the depot with a value that implies more was booked than was
 * actually worked, or more than the configured max.
 *
 * Depot delta is `max(0, bookingSec - dailyMin) + (workedSec - bookingSec)`:
 * the first term banks ordinary overtime on what got booked as today's
 * hours, the second banks whatever *isn't* booked (e.g. because it's over
 * the max) — together always equal to `workedSec - dailyMin` whenever
 * `bookingSec` is left at its default, and never negative, so the depot
 * only ever grows.
 */
export function bookDay(
	data: TrackingData,
	bookingSec: number,
	nowSec: number,
): TrackingData {
	const worked = workedSec(data.blocks, nowSec)
	const dailyMinSec = data.settings.dailyMinimum * 60
	const dailyMaxSec = data.settings.dailyMax * 60
	const clampedBookingSec = Math.min(
		Math.max(0, bookingSec),
		Math.min(worked, dailyMaxSec),
	)
	const delta = Math.max(0, clampedBookingSec - dailyMinSec) + (worked - clampedBookingSec)

	return {
		...data,
		blocks: [{ start: null, end: null }],
		buchungen: [
			...data.buchungen,
			{
				t: nowSec,
				workedSec: worked,
				bookingSec: clampedBookingSec,
				depotAfterSec: depotSec(data) + delta,
			},
		],
	}
}

export type TrackingSummary = {
	isRunning: boolean
	workedSec: number
	depotSec: number
	feierabendSec: number
	defaultBookingSec: number
}

export function summarize(data: TrackingData, now: Date = new Date()): TrackingSummary {
	const nowSec = Math.floor(now.getTime() / 1000)
	const worked = workedSec(data.blocks, nowSec)
	const depot = depotSec(data)
	const dailyMaxSec = data.settings.dailyMax * 60

	return {
		isRunning: isRunning(data.blocks),
		workedSec: worked,
		depotSec: depot,
		feierabendSec: nowSec + data.settings.dailyMinimum * 60 - depot - worked,
		defaultBookingSec: Math.min(worked, dailyMaxSec),
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
