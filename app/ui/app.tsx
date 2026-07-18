import { clientEntry, type Handle, on, type RemixNode } from "remix/ui"

import {
	formatClockTime,
	formatDayMonth,
	formatWeekdayName,
} from "../utils/date-format.ts"
import {
	buildExampleData,
	type Example,
	findExample,
	resolvePretendNow,
} from "../utils/examples.ts"
import { loadTrackingData, saveTrackingData } from "../utils/local-store.ts"
import {
	createTrackingData,
	type DateFormat,
	formatDuration,
	resolveCatchup,
	summarize,
	type TrackingData,
	toggleTracking,
	weeklyBreakdown,
	weeklyEntryDays,
} from "../utils/time-tracking.ts"
import {
	decryptTrackingData,
	deserializeEncryptedDocument,
	encryptTrackingData,
	type SerializedEncryptedDocument,
	serializeEncryptedDocument,
} from "../utils/tracking-document.ts"

type View =
	| { kind: "loading" }
	| { kind: "setup" }
	| { kind: "unlock"; id: string; error?: string }
	| { kind: "tracking"; data: TrackingData }
	// In-memory only — see app/utils/examples.ts. `offsetMs` is the fixed
	// gap between the example's pretend "now" and the real clock, captured
	// once at load so the pretend clock still ticks forward live.
	| { kind: "example"; data: TrackingData; example: Example; offsetMs: number }

type SyncStatus = "idle" | "syncing" | "synced" | "error"

const DOC_URL_PATTERN = /^\/d\/([A-Za-z0-9_-]+)$/
const EXAMPLE_URL_PATTERN = /^\/example\/([a-z0-9-]+)$/

function readDocIdFromUrl(): string | null {
	return DOC_URL_PATTERN.exec(window.location.pathname)?.[1] ?? null
}

function readExampleIdFromUrl(): string | null {
	return EXAMPLE_URL_PATTERN.exec(window.location.pathname)?.[1] ?? null
}

function readMinutes(
	formData: FormData,
	hoursField: string,
	minutesField: string,
): number {
	const hours = Number(formData.get(hoursField))
	const minutes = Number(formData.get(minutesField))
	return hours * 60 + minutes
}

/** The "did not work" checkbox always wins over whatever's left in the hour/minute fields. */
function readCatchupMinutes(formData: FormData, i: number): number {
	if (formData.get(`day-${i}-skip`) === "on") return 0
	return readMinutes(formData, `day-${i}-hours`, `day-${i}-minutes`)
}

function toggleCatchupDayFields(
	fieldset: HTMLFieldSetElement | null,
	disabled: boolean,
) {
	if (!fieldset) return
	for (const input of fieldset.querySelectorAll("input[type=number]")) {
		;(input as HTMLInputElement).disabled = disabled
	}
}

function buildExampleView(example: Example): View {
	const realNow = new Date()
	const data = buildExampleData(example, realNow)
	const offsetMs =
		resolvePretendNow(example, realNow).getTime() - realNow.getTime()
	return { kind: "example", data, example, offsetMs }
}

function syncStatusLabel(status: SyncStatus): string | null {
	switch (status) {
		case "syncing":
			return "Syncing..."
		case "synced":
			return "Synced"
		case "error":
			return "Sync failed (offline?)"
		case "idle":
			return null
	}
}

/**
 * Cross-field match isn't expressible via native HTML attributes, so this is
 * the one thing that needs a JS assist — via the Constraint Validation API
 * rather than app state, so the browser still owns *when* to surface it
 * (on submit attempt, same as `required`) and there's no "have we shown the
 * error yet" flag to keep in sync.
 */
function syncPasswordMatchValidity(form: HTMLFormElement | null) {
	if (!form) return
	const password = form.elements.namedItem("password") as HTMLInputElement
	const repeat = form.elements.namedItem("passwordRepeat") as HTMLInputElement
	repeat.setCustomValidity(
		password.value === repeat.value ? "" : "Passwords don't match",
	)
}

export const App = clientEntry(import.meta.url, function App(handle: Handle) {
	let view: View = { kind: "loading" }

	// Set once setup succeeds; kept in memory for the rest of this page load
	// only (never persisted). A reload that finds data already in local
	// storage never needs it — see requirement #4.
	let sessionPassword: string | null = null
	let syncStatus: SyncStatus = "idle"

	handle.queueTask(async (signal) => {
		// An example URL always wins, even over existing real local data —
		// it's never written to storage, so showing it can't lose anything,
		// and a user who explicitly opened the link should see it.
		const exampleId = readExampleIdFromUrl()
		const example = exampleId ? findExample(exampleId) : undefined
		if (example) {
			view = buildExampleView(example)
			handle.update()
			return
		}

		const data = await loadTrackingData()
		if (signal.aborted) return
		if (data) {
			view = { kind: "tracking", data }
		} else {
			const id = readDocIdFromUrl()
			view = id ? { kind: "unlock", id } : { kind: "setup" }
		}
		handle.update()
	})

	// Keeps the always-visible remaining time live. Browser-only: on the server
	// this timer would outlive the one-shot SSR render and crash the process.
	if (typeof window !== "undefined") {
		const interval = setInterval(() => handle.update(), 1000)
		handle.signal.addEventListener("abort", () => clearInterval(interval))
	}

	async function syncToServer(data: TrackingData, password: string) {
		syncStatus = "syncing"
		handle.update()
		try {
			const doc = await encryptTrackingData(data, password)
			const response = await fetch(`/sync/${encodeURIComponent(data.id)}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(serializeEncryptedDocument(doc)),
			})
			syncStatus = response.ok ? "synced" : "error"
		} catch {
			syncStatus = "error"
		}
		handle.update()
	}

	async function handleSetupSubmit(formData: FormData) {
		const data = createTrackingData({
			weeklyTargetMin: readMinutes(formData, "weeklyHours", "weeklyMinutes"),
			dailyMax: readMinutes(formData, "dailyHours", "dailyMinutes"),
			dateFormat: (formData.get("dateFormat") as DateFormat | null) ?? "de",
		})
		await saveTrackingData(data)
		sessionPassword = String(formData.get("password") ?? "")
		view = { kind: "tracking", data }
		handle.update()
		// Makes the URL bookmarkable so it can be used to recover this
		// document later if local storage gets cleared.
		window.history.replaceState(null, "", `/d/${data.id}`)
		void syncToServer(data, sessionPassword)
	}

	async function handleUnlockSubmit(id: string, unlockPassword: string) {
		const response = await fetch(`/sync/${encodeURIComponent(id)}`)
		if (!response.ok) {
			view = { kind: "unlock", id, error: "No data found for this link." }
			handle.update()
			return
		}

		const serialized = (await response.json()) as SerializedEncryptedDocument
		const doc = deserializeEncryptedDocument(serialized)
		try {
			const data = await decryptTrackingData(doc, unlockPassword)
			await saveTrackingData(data)
			sessionPassword = unlockPassword
			view = { kind: "tracking", data }
		} catch {
			view = { kind: "unlock", id, error: "Wrong password." }
		}
		handle.update()
	}

	async function handleCatchupSubmit(
		data: TrackingData,
		days: Date[],
		formData: FormData,
	) {
		const workedMinutesPerDay = days.map((_, i) =>
			readCatchupMinutes(formData, i),
		)
		data.events = resolveCatchup(data.events, days, workedMinutesPerDay)
		await saveTrackingData(data)
		handle.update()
		if (sessionPassword) void syncToServer(data, sessionPassword)
	}

	async function handleToggle(data: TrackingData) {
		data.events = toggleTracking(data.events, Math.floor(Date.now() / 1000))
		await saveTrackingData(data)
		handle.update()
		if (sessionPassword) void syncToServer(data, sessionPassword)
	}

	// Example handlers mirror the real ones above but stay in-memory only —
	// no saveTrackingData, no syncToServer — since example data is strictly
	// throwaway (see app/utils/examples.ts).
	function handleExampleToggle(data: TrackingData, now: Date) {
		data.events = toggleTracking(data.events, Math.floor(now.getTime() / 1000))
		handle.update()
	}

	function handleExampleCatchupSubmit(
		data: TrackingData,
		days: Date[],
		formData: FormData,
	) {
		const workedMinutesPerDay = days.map((_, i) =>
			readCatchupMinutes(formData, i),
		)
		data.events = resolveCatchup(data.events, days, workedMinutesPerDay)
		handle.update()
	}

	return () => {
		if (view.kind === "loading") return <p>Loading...</p>

		if (view.kind === "unlock") {
			const { id, error } = view

			return (
				<form
					mix={on("submit", (event) => {
						event.preventDefault()
						const formData = new FormData(event.currentTarget)
						void handleUnlockSubmit(id, String(formData.get("password") ?? ""))
					})}
				>
					<h1>clockout</h1>
					<p>This browser doesn't have local data for this link.</p>
					<label>
						Password
						<input
							name="password"
							type="password"
							autoComplete="current-password"
							required
						/>
					</label>
					{error && <p role="alert">{error}</p>}
					<button type="submit">Unlock</button>
				</form>
			)
		}

		if (view.kind === "setup") {
			return (
				<form
					mix={on("submit", (event) => {
						event.preventDefault()
						void handleSetupSubmit(new FormData(event.currentTarget))
					})}
				>
					<h1>clockout</h1>

					<fieldset>
						<legend>Weekly target</legend>
						<input
							name="weeklyHours"
							type="number"
							min="0"
							max="168"
							defaultValue="35"
						/>{" "}
						h
						<input
							name="weeklyMinutes"
							type="number"
							min="0"
							max="59"
							defaultValue="0"
						/>{" "}
						m
					</fieldset>

					<fieldset>
						<legend>Daily max</legend>
						<input
							name="dailyHours"
							type="number"
							min="0"
							max="23"
							defaultValue="9"
						/>{" "}
						h
						<input
							name="dailyMinutes"
							type="number"
							min="0"
							max="59"
							defaultValue="55"
						/>{" "}
						m
					</fieldset>

					<label>
						Date format
						<select name="dateFormat" defaultValue="de">
							<option value="de">German (17.07.2026, 24h)</option>
							<option value="iso">ISO 8601 (2026-07-17, 24h)</option>
							<option value="auto">Browser default</option>
						</select>
					</label>

					<label>
						Password
						<input
							name="password"
							type="password"
							autoComplete="new-password"
							required
							mix={on("input", (event) => {
								syncPasswordMatchValidity(event.currentTarget.form)
							})}
						/>
					</label>

					<label>
						Repeat password
						<input
							name="passwordRepeat"
							type="password"
							autoComplete="new-password"
							required
							mix={on("input", (event) => {
								syncPasswordMatchValidity(event.currentTarget.form)
							})}
						/>
					</label>

					<button type="submit">Speichern und los ...</button>
				</form>
			)
		}

		if (view.kind === "tracking") {
			const { data } = view
			return renderTrackingScreen(
				data,
				new Date(),
				() => void handleToggle(data),
				(days, formData) => void handleCatchupSubmit(data, days, formData),
				undefined,
				syncStatusLabel(syncStatus) && (
					<p role="status">{syncStatusLabel(syncStatus)}</p>
				),
			)
		}

		const { data, example, offsetMs } = view
		const now = new Date(Date.now() + offsetMs)

		return renderTrackingScreen(
			data,
			now,
			() => handleExampleToggle(data, now),
			(days, formData) => handleExampleCatchupSubmit(data, days, formData),
			<p role="status">
				Demo: simulating "{example.title}" —{" "}
				{formatWeekdayName(now, data.settings.dateFormat, "long")},{" "}
				{formatClockTime(now, data.settings.dateFormat)}. Nothing here is saved.{" "}
				<a href="/about">Back to examples</a>
			</p>,
		)
	}
})

function renderTrackingScreen(
	data: TrackingData,
	now: Date,
	onToggle: () => void,
	onCatchupSubmit: (days: Date[], formData: FormData) => void,
	banner?: RemixNode,
	footer?: RemixNode,
) {
	const entryDays = weeklyEntryDays(data.events, now)
	const entryDayIndex = new Map(entryDays.map((day, i) => [day.getTime(), i]))
	const summary = summarize(data, now)

	const weekList = weeklyBreakdown(data.events, now).map(
		({ day, workedSec }) => {
			const label = `${formatWeekdayName(day, data.settings.dateFormat, "short")}, ${formatDayMonth(day, data.settings.dateFormat)}`
			const i = entryDayIndex.get(day.getTime())

			if (i === undefined) {
				return (
					<li key={day.getTime()}>
						{label}: {formatDuration(workedSec)}
					</li>
				)
			}

			return (
				<li key={day.getTime()}>
					<fieldset>
						<legend>{label}</legend>
						<input
							name={`day-${i}-hours`}
							type="number"
							min="0"
							max="23"
							defaultValue="0"
						/>{" "}
						h
						<input
							name={`day-${i}-minutes`}
							type="number"
							min="0"
							max="59"
							defaultValue="0"
						/>{" "}
						m
						<label>
							<input
								name={`day-${i}-skip`}
								type="checkbox"
								mix={on("change", (event) => {
									toggleCatchupDayFields(
										event.currentTarget.closest("fieldset"),
										event.currentTarget.checked,
									)
								})}
							/>{" "}
							Did not work
						</label>
					</fieldset>
				</li>
			)
		},
	)

	return (
		<div>
			{banner}
			<p>Week remaining: {formatDuration(summary.weeklyRemainingSec)}</p>
			<p>Day remaining: {formatDuration(summary.dailyRemainingSec)}</p>
			{summary.startedAt !== null && (
				<p>
					Started at{" "}
					{formatClockTime(
						new Date(summary.startedAt * 1000),
						data.settings.dateFormat,
					)}
				</p>
			)}
			{entryDays.length > 0 ? (
				<form
					mix={on("submit", (event) => {
						event.preventDefault()
						onCatchupSubmit(entryDays, new FormData(event.currentTarget))
					})}
				>
					<p>
						Some days this week have no tracked hours yet. Enter how many hours
						you worked, or check "Did not work".
					</p>
					<ul>{weekList}</ul>
					<button type="submit">Save hours</button>
				</form>
			) : (
				<ul>{weekList}</ul>
			)}
			<button
				type="button"
				className="toggle-button"
				mix={on("click", onToggle)}
				data-running={summary.isRunning}
			>
				{summary.isRunning ? "Stop" : "Start"}
			</button>
			{footer}
		</div>
	)
}
