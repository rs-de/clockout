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
import {
	createTranslator,
	DEFAULT_LANG,
	type Lang,
	type Translator,
} from "../utils/i18n.ts"
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

function readCatchupSkip(formData: FormData, i: number): boolean {
	return formData.get(`day-${i}-skip`) === "on"
}

/** The "did not work" checkbox always wins over whatever's left in the hour/minute fields. */
function readCatchupMinutes(formData: FormData, i: number): number {
	if (readCatchupSkip(formData, i)) return 0
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

function syncStatusLabel(status: SyncStatus, t: Translator): string | null {
	switch (status) {
		case "syncing":
			return t("Syncing...")
		case "synced":
			return t("Synced")
		case "error":
			return t("Sync failed (offline?)")
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
function syncPasswordMatchValidity(
	form: HTMLFormElement | null,
	t: Translator,
) {
	if (!form) return
	const password = form.elements.namedItem("password") as HTMLInputElement
	const repeat = form.elements.namedItem("passwordRepeat") as HTMLInputElement
	repeat.setCustomValidity(
		password.value === repeat.value ? "" : t("Passwords don't match"),
	)
}

export interface AppProps {
	lang?: Lang
}

export const App = clientEntry(
	import.meta.url,
	function App(handle: Handle<AppProps>) {
		let view: View = { kind: "loading" }

		// Fixed for the component's lifetime — resolved once server-side per
		// request (see controller.tsx) and never changes mid-session.
		const t = createTranslator(handle.props.lang ?? DEFAULT_LANG)

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
				view = { kind: "unlock", id, error: t("No data found for this link.") }
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
				view = { kind: "unlock", id, error: t("Wrong password.") }
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
			const skipDayFlags = days.map((_, i) => readCatchupSkip(formData, i))
			data.events = resolveCatchup(
				data.events,
				days,
				workedMinutesPerDay,
				skipDayFlags,
			)
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
			data.events = toggleTracking(
				data.events,
				Math.floor(now.getTime() / 1000),
			)
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
			const skipDayFlags = days.map((_, i) => readCatchupSkip(formData, i))
			data.events = resolveCatchup(
				data.events,
				days,
				workedMinutesPerDay,
				skipDayFlags,
			)
			handle.update()
		}

		return () => {
			if (view.kind === "loading") return <p>Loading...</p>

			if (view.kind === "unlock") {
				const { id, error } = view

				return (
					<form
						class="form-card"
						mix={on("submit", (event) => {
							event.preventDefault()
							const formData = new FormData(event.currentTarget)
							void handleUnlockSubmit(
								id,
								String(formData.get("password") ?? ""),
							)
						})}
					>
						<h1>clockout</h1>
						<p class="form-intro">
							{t("This browser doesn't have local data for this link.")}
						</p>
						<label class="form-field">
							{t("Password")}
							<input
								name="password"
								type="password"
								autoComplete="current-password"
								required
							/>
						</label>
						{error && (
							<p class="field-error" role="alert">
								{error}
							</p>
						)}
						<button type="submit" class="btn btn-primary">
							{t("Unlock")}
						</button>
					</form>
				)
			}

			if (view.kind === "setup") {
				return (
					<form
						class="form-card"
						mix={on("submit", (event) => {
							event.preventDefault()
							void handleSetupSubmit(new FormData(event.currentTarget))
						})}
					>
						<h1>clockout</h1>

						<p class="form-intro">
							{t(
								"Set a password to encrypt your data before it's synced online — only you can unlock it. You'll only need to enter it again if this browser's storage is cleared or you open your link elsewhere.",
							)}
						</p>

						<label class="form-field">
							{t("Password")}
							<input
								name="password"
								type="password"
								autoComplete="new-password"
								required
								mix={on("input", (event) => {
									syncPasswordMatchValidity(event.currentTarget.form, t)
								})}
							/>
						</label>

						<label class="form-field">
							{t("Repeat password")}
							<input
								name="passwordRepeat"
								type="password"
								autoComplete="new-password"
								required
								mix={on("input", (event) => {
									syncPasswordMatchValidity(event.currentTarget.form, t)
								})}
							/>
						</label>

						<fieldset>
							<legend>{t("Weekly target")}</legend>
							<div class="hm-row">
								<input
									name="weeklyHours"
									type="number"
									min="0"
									max="168"
									defaultValue="35"
								/>
								<span class="unit">{t("h")}</span>
								<input
									name="weeklyMinutes"
									type="number"
									min="0"
									max="59"
									defaultValue="0"
								/>
								<span class="unit">{t("m")}</span>
							</div>
							<p class="field-hint">
								{t("Used to calculate how much time you have left this week.")}
							</p>
						</fieldset>

						<fieldset>
							<legend>{t("Daily max")}</legend>
							<div class="hm-row">
								<input
									name="dailyHours"
									type="number"
									min="0"
									max="23"
									defaultValue="9"
								/>
								<span class="unit">{t("h")}</span>
								<input
									name="dailyMinutes"
									type="number"
									min="0"
									max="59"
									defaultValue="55"
								/>
								<span class="unit">{t("m")}</span>
							</div>
							<p class="field-hint">
								{t("Used to calculate how much time you have left today.")}
							</p>
						</fieldset>

						<div class="form-field">
							<label class="form-field">
								{t("Date format")}
								<select name="dateFormat" defaultValue="de">
									<option value="de">{t("German (17.07.2026, 24h)")}</option>
									<option value="iso">{t("ISO 8601 (2026-07-17, 24h)")}</option>
									<option value="auto">{t("Browser default")}</option>
								</select>
							</label>
							<p class="field-hint">
								{t("How dates and times are displayed throughout the app.")}
							</p>
						</div>

						<button type="submit" class="btn btn-primary">
							{t("Save and start tracking")}
						</button>
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
					t,
					undefined,
					syncStatusLabel(syncStatus, t) && (
						<p role="status">{syncStatusLabel(syncStatus, t)}</p>
					),
				)
			}

			const { data, example, offsetMs } = view
			const now = new Date(Date.now() + offsetMs)
			const dateTime = `${formatWeekdayName(now, data.settings.dateFormat, "long")}, ${formatClockTime(now, data.settings.dateFormat)}`

			return renderTrackingScreen(
				data,
				now,
				() => handleExampleToggle(data, now),
				(days, formData) => handleExampleCatchupSubmit(data, days, formData),
				t,
				<p role="status">
					{t('Demo: simulating "{name}" — {dateTime}. Nothing here is saved.', {
						name: t(example.title),
						dateTime,
					})}{" "}
					<a href="/about">{t("Back to examples")}</a>
				</p>,
			)
		}
	},
)

function renderTrackingScreen(
	data: TrackingData,
	now: Date,
	onToggle: () => void,
	onCatchupSubmit: (days: Date[], formData: FormData) => void,
	t: Translator,
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
					<li key={day.getTime()} className="data-row">
						{label}: {formatDuration(workedSec)}
					</li>
				)
			}

			// A weekend day only ever reaches this pending-entry branch because
			// its own Friday wasn't stopped, not because the weekend itself is
			// likely worked — so pre-check "Did not work" for it (Friday stays
			// unchecked, since that's the day that actually needs real hours).
			const isWeekend = day.getDay() === 0 || day.getDay() === 6

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
							disabled={isWeekend}
						/>{" "}
						{t("h")}
						<input
							name={`day-${i}-minutes`}
							type="number"
							min="0"
							max="59"
							defaultValue="0"
							disabled={isWeekend}
						/>{" "}
						{t("m")}
						<label>
							<input
								name={`day-${i}-skip`}
								type="checkbox"
								defaultChecked={isWeekend}
								mix={on("change", (event) => {
									toggleCatchupDayFields(
										event.currentTarget.closest("fieldset"),
										event.currentTarget.checked,
									)
								})}
							/>{" "}
							{t("Did not work")}
						</label>
					</fieldset>
				</li>
			)
		},
	)

	return (
		<div>
			{banner}
			<p>
				{t("Week remaining: {duration}", {
					duration: formatDuration(summary.weeklyRemainingSec),
				})}
			</p>
			<p>
				{t("Day remaining: {duration}", {
					duration: formatDuration(summary.dailyRemainingSec),
				})}
			</p>
			{summary.startedAt !== null && (
				<p>
					{t("Started at {time}", {
						time: formatClockTime(
							new Date(summary.startedAt * 1000),
							data.settings.dateFormat,
						),
					})}
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
						{t(
							'Some days this week have no tracked hours yet. Enter how many hours you worked, or check "Did not work".',
						)}
					</p>
					<ul>{weekList}</ul>
					<button type="submit" class="btn btn-primary">
						{t("Save hours")}
					</button>
				</form>
			) : (
				<ul>{weekList}</ul>
			)}
			{
				// A dangling start from an earlier day (not today) has nothing
				// live to "stop" — closing it here would just slap a "stop" on
				// it at whatever moment this button happens to get clicked,
				// silently collapsing the whole unresolved gap (including any
				// still-dangling weekend) into one bogus multi-day session.
				// Only the catch-up form above can close it correctly, per day.
				!(summary.isRunning && summary.startedAt === null) && (
					<button
						type="button"
						className="toggle-button"
						mix={on("click", onToggle)}
						data-running={summary.isRunning}
					>
						{summary.isRunning ? t("Stop") : t("Start")}
					</button>
				)
			}
			{footer}
		</div>
	)
}
