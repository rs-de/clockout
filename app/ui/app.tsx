import { clientEntry, type Handle, on } from "remix/ui"

import { loadTrackingData, saveTrackingData } from "../utils/local-store.ts"
import {
	catchupDays,
	createTrackingData,
	formatDuration,
	resolveCatchup,
	summarize,
	type TrackingData,
	toggleTracking,
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

type SyncStatus = "idle" | "syncing" | "synced" | "error"

const DOC_URL_PATTERN = /^\/d\/([A-Za-z0-9_-]+)$/

function readDocIdFromUrl(): string | null {
	return DOC_URL_PATTERN.exec(window.location.pathname)?.[1] ?? null
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
			readMinutes(formData, `day-${i}-hours`, `day-${i}-minutes`),
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
						<input name="weeklyHours" type="number" min="0" defaultValue="35" />{" "}
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
						<input name="dailyHours" type="number" min="0" defaultValue="9" /> h
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

		const { data } = view
		const days = catchupDays(data.events, new Date())

		if (days.length > 0) {
			return (
				<form
					mix={on("submit", (event) => {
						event.preventDefault()
						void handleCatchupSubmit(
							data,
							days,
							new FormData(event.currentTarget),
						)
					})}
				>
					<h1>clockout</h1>
					<p>
						Looks like tracking wasn't running on some past days. Enter how many
						hours you worked on each day since then.
					</p>
					{days.map((day, i) => (
						<fieldset key={day.getTime()}>
							<legend>
								{day.toLocaleDateString(undefined, {
									weekday: "short",
									day: "2-digit",
									month: "2-digit",
								})}
							</legend>
							<input
								name={`day-${i}-hours`}
								type="number"
								min="0"
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
						</fieldset>
					))}
					<button type="submit">Save and continue</button>
				</form>
			)
		}

		const summary = summarize(data)

		return (
			<div>
				<p>Week remaining: {formatDuration(summary.weeklyRemainingSec)}</p>
				<p>Day remaining: {formatDuration(summary.dailyRemainingSec)}</p>
				{summary.startedAt !== null && (
					<p>
						Started at{" "}
						{new Date(summary.startedAt * 1000).toLocaleTimeString(undefined, {
							hour: "2-digit",
							minute: "2-digit",
						})}
					</p>
				)}
				<button
					type="button"
					className="toggle-button"
					mix={on("click", () => void handleToggle(data))}
					data-running={summary.isRunning}
				>
					{summary.isRunning ? "Stop" : "Start"}
				</button>
				{syncStatusLabel(syncStatus) && (
					<p role="status">{syncStatusLabel(syncStatus)}</p>
				)}
			</div>
		)
	}
})
