import {
	DEFAULT_DAILY_MAX,
	DEFAULT_WEEKLY_TARGET_MIN,
	type RelativeEvent,
	resolveRelativeEvents,
	startOfWeek,
	type TrackingData,
} from "./time-tracking.ts"

export type Example = {
	id: string
	title: string
	description: string
	/**
	 * The moment this example pretends "now" is: a weekday (0 = Monday .. 6 =
	 * Sunday) anchored to the real current week — so the simulated date never
	 * goes stale — plus a fixed local time-of-day chosen deliberately after
	 * every same-day ("daysAgo: 0") event time below, so nothing in the
	 * example is ever dated in the pretend future.
	 */
	pretendWeekday: number
	pretendTime: string
	events: RelativeEvent[]
}

export const EXAMPLES: Example[] = [
	{
		id: "forgot-stop",
		title: "Forgot to stop",
		description:
			"An open session from a few days ago that was never stopped — shows the catch-up form.",
		pretendWeekday: 4, // Friday
		pretendTime: "09:30",
		events: [{ daysAgo: 3, time: "09:15", type: "start" }],
	},
	{
		id: "lunch-break",
		title: "Lunch break",
		description:
			"Stopped for lunch and restarted — the shown start time stays pinned to the morning.",
		pretendWeekday: 2, // Wednesday
		pretendTime: "15:00",
		events: [
			{ daysAgo: 0, time: "09:00", type: "start" },
			{ daysAgo: 0, time: "12:00", type: "stop" },
			{ daysAgo: 0, time: "13:00", type: "start" },
		],
	},
	{
		id: "steady-week",
		title: "A steady week",
		description: "Four completed days, and Friday afternoon almost done.",
		pretendWeekday: 4, // Friday
		pretendTime: "16:00",
		events: [
			{ daysAgo: 4, time: "09:00", type: "start" },
			{ daysAgo: 4, time: "17:00", type: "stop" },
			{ daysAgo: 3, time: "09:00", type: "start" },
			{ daysAgo: 3, time: "17:00", type: "stop" },
			{ daysAgo: 2, time: "09:00", type: "start" },
			{ daysAgo: 2, time: "17:00", type: "stop" },
			{ daysAgo: 1, time: "09:00", type: "start" },
			{ daysAgo: 1, time: "17:00", type: "stop" },
			{ daysAgo: 0, time: "09:00", type: "start" },
		],
	},
]

export function findExample(id: string): Example | undefined {
	return EXAMPLES.find((example) => example.id === id)
}

/**
 * The example's pretend "now" the instant it's opened — `pretendWeekday`
 * within `realNow`'s real week, at the example's own fixed `pretendTime`.
 * This is a static anchor, not a live clock: callers that want the demo to
 * keep ticking forward (see requirement #7) capture this once at load time,
 * derive a fixed offset from the real clock, and re-apply that offset to
 * the real "now" on every later render — see `app/ui/app.tsx`.
 */
export function resolvePretendNow(example: Example, realNow: Date): Date {
	const [hours, minutes] = example.pretendTime.split(":").map(Number)
	const pretendNow = startOfWeek(realNow)
	pretendNow.setDate(pretendNow.getDate() + example.pretendWeekday)
	pretendNow.setHours(hours ?? 0, minutes ?? 0, 0, 0)
	return pretendNow
}

/** Builds a fresh, in-memory-only TrackingData for `example`, relative to `realNow`. */
export function buildExampleData(
	example: Example,
	realNow: Date,
): TrackingData {
	const pretendNow = resolvePretendNow(example, realNow)
	return {
		id: `example-${example.id}`,
		settings: {
			weeklyTargetMin: DEFAULT_WEEKLY_TARGET_MIN,
			dailyMax: DEFAULT_DAILY_MAX,
		},
		events: resolveRelativeEvents(example.events, pretendNow),
	}
}
