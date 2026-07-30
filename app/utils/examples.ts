import {
	type Block,
	type Booking,
	DEFAULT_DAILY_MAX,
	DEFAULT_DAILY_MINIMUM,
	DEFAULT_DATE_FORMAT,
	type TrackingData,
} from "./time-tracking.ts"

export type RelativeBlock = {
	/** Local "HH:MM", resolved against the same pretend day as the example's `pretendTime`. */
	start: string
	/** Omitted for a still-open block. */
	end?: string
}

export type Example = {
	id: string
	title: string
	description: string
	/**
	 * Local "HH:MM" time-of-day this example pretends "now" is, anchored to
	 * today's real date — so the simulated moment never goes stale. No
	 * weekday to anchor to anymore now that tracking is single-day.
	 */
	pretendTime: string
	blocks: RelativeBlock[]
	/** Depot balance already banked before this example opens, e.g. to show
	 * off requirement #8's quitting-time credit. */
	depotSec?: number
	/** Simulates already having booked out for the day, via a booking dated
	 * `pretendNow` itself (see `buildExampleData`) — shows off the
	 * "done for today" headline instead of a fresh quitting-time estimate. */
	bookedToday?: boolean
}

// Ordered from the most ordinary case to the most edge-case-y, since this
// is also the order the About page lists them in — a first-time visitor
// should see what normal, everyday use looks like before the two
// requirement-specific demos.
export const EXAMPLES: Example[] = [
	{
		id: "lunch-break",
		title: "Lunch break",
		description:
			"A finished morning block, then an afternoon block still running after lunch.",
		pretendTime: "15:00",
		blocks: [{ start: "09:00", end: "12:00" }, { start: "13:00" }],
	},
	{
		id: "depot-credit",
		title: "Overtime already banked",
		description:
			"Yesterday's overtime is already in the depot, so today's quitting time comes earlier.",
		pretendTime: "08:00",
		blocks: [],
		depotSec: 3 * 60 * 60,
	},
	{
		id: "past-quitting-time",
		title: "Already past quitting time",
		description:
			"A long open session — quitting time is shown as a real clock time even once it's in the past.",
		pretendTime: "18:00",
		blocks: [{ start: "08:00" }],
	},
	{
		id: "done-for-today",
		title: "Booked out for the day",
		description:
			"Already booked out late in the evening — the headline shows the day is done, not a fresh middle-of-the-night quitting time.",
		pretendTime: "23:50",
		blocks: [],
		bookedToday: true,
	},
]

export function findExample(id: string): Example | undefined {
	return EXAMPLES.find((example) => example.id === id)
}

/**
 * The example's pretend "now" the instant it's opened — today's real date at
 * the example's own fixed `pretendTime`. A static anchor, not a live clock:
 * callers that want the demo to keep ticking forward (requirement #8's live
 * quitting-time estimate) capture this once at load time, derive a fixed
 * offset from the real clock, and re-apply that offset to the real "now" on
 * every later render — see `app/ui/app.tsx`.
 */
export function resolvePretendNow(example: Example, realNow: Date): Date {
	const [hours, minutes] = example.pretendTime.split(":").map(Number)
	const pretendNow = new Date(realNow)
	pretendNow.setHours(hours ?? 0, minutes ?? 0, 0, 0)
	return pretendNow
}

function resolveBlockTime(time: string, pretendDay: Date): number {
	const [hours, minutes] = time.split(":").map(Number)
	const d = new Date(pretendDay)
	d.setHours(hours ?? 0, minutes ?? 0, 0, 0)
	return Math.floor(d.getTime() / 1000)
}

/** Resolves `RelativeBlock`s (local "HH:MM" strings) against `pretendNow`'s
 * calendar day into real `Block`s. */
export function resolveRelativeBlocks(
	relativeBlocks: RelativeBlock[],
	pretendNow: Date,
): Block[] {
	return relativeBlocks.map(({ start, end }) => ({
		start: resolveBlockTime(start, pretendNow),
		end: end ? resolveBlockTime(end, pretendNow) : null,
	}))
}

/** Builds a fresh, in-memory-only TrackingData for `example`, relative to `realNow`. */
export function buildExampleData(
	example: Example,
	realNow: Date,
): TrackingData {
	const pretendNow = resolvePretendNow(example, realNow)
	const blocks = resolveRelativeBlocks(example.blocks, pretendNow)

	// Mirrors the real app's trailing-empty-block invariant (see
	// `ensureTrailingBlock` in time-tracking.ts): only add one once the last
	// block is actually complete — a still-open block is already the active one.
	const last = blocks.at(-1)
	if (!last || last.end !== null) blocks.push({ start: null, end: null })

	// Stamped the instant before pretendNow's calendar day starts — not just
	// "pretendNow minus a second" — so it reads as yesterday's booking, not
	// today's (which `summarize`'s isDoneForToday would otherwise mistake for
	// "already booked out today" and show the wrong headline).
	const pretendDayStart = new Date(pretendNow)
	pretendDayStart.setHours(0, 0, 0, 0)
	const bookings: Booking[] = example.depotSec
		? [
				{
					t: Math.floor(pretendDayStart.getTime() / 1000) - 1,
					workedSec: 0,
					bookingSec: 0,
					depotAfterSec: example.depotSec,
				},
			]
		: []

	// The opposite of the depotSec booking above: dated `pretendNow` itself,
	// so it *does* read as "booked out today" and drives isDoneForToday.
	if (example.bookedToday) {
		const workedSec = DEFAULT_DAILY_MINIMUM * 60
		bookings.push({
			t: Math.floor(pretendNow.getTime() / 1000),
			workedSec,
			bookingSec: workedSec,
			depotAfterSec: bookings.at(-1)?.depotAfterSec ?? 0,
		})
	}

	return {
		id: `example-${example.id}`,
		settings: {
			dailyMinimum: DEFAULT_DAILY_MINIMUM,
			dailyMax: DEFAULT_DAILY_MAX,
			dateFormat: DEFAULT_DATE_FORMAT,
		},
		blocks,
		bookings,
	}
}
