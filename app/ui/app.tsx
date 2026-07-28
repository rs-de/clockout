import { nanoid } from "nanoid"
import { clientEntry, type Handle, on, type RemixNode } from "remix/ui"

import { formatClockTime, formatWeekdayName } from "../utils/date-format.ts"
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
import {
	loadSyncKey,
	loadTrackingData,
	saveSyncKey,
	saveTrackingData,
} from "../utils/local-store.ts"
import { createSyncEngine, type SyncStatus } from "../utils/sync-engine.ts"
import {
	type Block,
	blockDurationSec,
	bookDay,
	createTrackingData,
	type DateFormat,
	formatDuration,
	setBlockField,
	startBlock,
	stopBlock,
	summarize,
	type TrackingData,
} from "../utils/time-tracking.ts"
import {
	decryptTrackingData,
	deriveTrackingKey,
	deserializeEncryptedDocument,
	type SerializedEncryptedDocument,
	type TrackingSyncKey,
} from "../utils/tracking-document.ts"

type View =
	| { kind: "loading" }
	// `id` is pre-generated (not just picked at submit time) so it can sit in
	// a hidden autocomplete="username" field from the first render — letting
	// password managers key the saved password to this doc from the start.
	| { kind: "setup"; id: string }
	| { kind: "unlock"; id: string; error?: string }
	// The home route (/) itself: local data already exists, but / is a
	// landing page, not the tracking screen — it only links to the
	// bookmarkable /d/:id, which is where "tracking" actually renders.
	| { kind: "home"; data: TrackingData }
	// Editing the global daily minimum/max/date format for an existing doc —
	// reached from "home", returns there on save or cancel.
	| { kind: "settings"; data: TrackingData }
	| { kind: "tracking"; data: TrackingData }
	// In-memory only — see app/utils/examples.ts. `offsetMs` is the fixed
	// gap between the example's pretend "now" and the real clock, captured
	// once at load so the pretend clock still ticks forward live.
	| { kind: "example"; data: TrackingData; example: Example; offsetMs: number }

const DOC_URL_PATTERN = /^\/d\/([A-Za-z0-9_-]+)$/
const EXAMPLE_URL_PATTERN = /^\/example\/([a-z0-9-]+)$/

function readDocIdFromUrl(): string | null {
	return DOC_URL_PATTERN.exec(window.location.pathname)?.[1] ?? null
}

function readExampleIdFromUrl(): string | null {
	return EXAMPLE_URL_PATTERN.exec(window.location.pathname)?.[1] ?? null
}

/**
 * The real UI path is already fully constrained by each field's own
 * `min`/`max`/`type="number"` — the browser blocks submission entirely for
 * an out-of-range or non-numeric value (native constraint validation runs
 * before the submit event even fires). This guards the one path that
 * bypasses that: FormData built or edited outside the real form (devtools,
 * a future regression). Without it, a non-numeric field yields `NaN`,
 * which would get permanently written into persisted settings or a
 * booking, poisoning every total that reads it from then on.
 */
function readMinutes(
	formData: FormData,
	hoursField: string,
	minutesField: string,
): number {
	const hours = Number(formData.get(hoursField))
	const minutes = Number(formData.get(minutesField))
	if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0
	return hours * 60 + minutes
}

/** `null` renders as an empty `<input type="time">`. */
function timeInputValue(sec: number | null): string {
	if (sec === null) return ""
	const d = new Date(sec * 1000)
	return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

/**
 * Resolves an `<input type="time">`'s `"HH:MM"` value against `nowSec`'s
 * calendar day — blocks are always today's (requirement #7 drops the old
 * per-day catch-up flow entirely), so there's no other day to anchor to. An
 * empty value (the field was cleared) resolves to `null`, unsetting the field.
 */
function parseTimeInput(value: string, nowSec: number): number | null {
	if (!value) return null
	const [hours, minutes] = value.split(":").map(Number)
	const d = new Date(nowSec * 1000)
	d.setHours(hours ?? 0, minutes ?? 0, 0, 0)
	return Math.floor(d.getTime() / 1000)
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

// Explicitly asks Chrome-family browsers to offer saving this password,
// instead of leaning on their heuristics for a form that never navigates
// (see handleSetupSubmit/handleUnlockSubmit, which do navigate now, but
// this is the more reliable signal where it's supported). Safari doesn't
// implement PasswordCredential at all, so this is a no-op there —
// feature-detected and best-effort, never throws.
async function storePasswordCredential(id: string, password: string) {
	if (typeof PasswordCredential === "undefined") return
	try {
		await navigator.credentials.store(
			new PasswordCredential({ id, password, name: id }),
		)
	} catch {
		// Ignored — e.g. the user already declined once for this id.
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

// Safari/WebKit-only: focusing a number input by click still lets the native
// mouseup that follows place the caret at the click position afterward,
// silently collapsing the selection `.select()` just made on focus (Tab
// focus has no such mouseup, so it's unaffected there). Track "just focused
// by this click" per element and re-assert the selection once on the
// following mouseup only, so a later click on an already-focused field still
// positions the caret normally instead of re-selecting everything.
const justFocusedByClick = new WeakSet<HTMLInputElement>()

function selectOnFocus(input: HTMLInputElement) {
	justFocusedByClick.add(input)
	input.select()
}

function reassertSelectOnMouseUp(input: HTMLInputElement, event: Event) {
	if (!justFocusedByClick.has(input)) return
	justFocusedByClick.delete(input)
	event.preventDefault()
	input.select()
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

		// Set once setup/unlock succeeds, and persisted via saveSyncKey so a
		// later reload can rehydrate it below without asking for the password
		// again — only a fresh browser/cleared storage needs to unlock.
		let sessionKey: TrackingSyncKey | null = null
		const syncEngine = createSyncEngine(() => handle.update())

		// Reads the current URL and resolves which view it maps to. Not just a
		// one-shot mount-time check: a soft (frame) navigation — e.g. clicking
		// the logo from an /example/:id page back to / — reuses this exact
		// component instance rather than remounting it, since both routes
		// render the same <App>. Without re-running this on every such
		// navigation, `view` stays frozen on whatever it resolved to at true
		// mount while the URL (and browser history) moves on underneath it —
		// the page looks like clicking the link did nothing.
		async function resolveView(signal: AbortSignal) {
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
				// / is a landing page, not the tracking screen itself — only
				// /d/:id (the bookmarkable URL setup already redirects to) shows
				// the real thing.
				view =
					window.location.pathname === "/"
						? { kind: "home", data }
						: { kind: "tracking", data }
				sessionKey = (await loadSyncKey()) ?? null
			} else {
				const id = readDocIdFromUrl()
				view = id ? { kind: "unlock", id } : { kind: "setup", id: nanoid() }
			}
			handle.update()
		}

		handle.queueTask((signal) => resolveView(signal))

		// Keeps the always-visible quitting-time estimate live. Browser-only: on
		// the server this timer would outlive the one-shot SSR render and crash
		// the process.
		if (typeof window !== "undefined") {
			const interval = setInterval(() => handle.update(), 1000)
			handle.signal.addEventListener("abort", () => clearInterval(interval))
			syncEngine.init(handle.signal)

			handle.frames.top.addEventListener(
				"reloadComplete",
				() => {
					view = { kind: "loading" }
					handle.update()
					handle.queueTask((signal) => resolveView(signal))
				},
				{ signal: handle.signal },
			)
		}

		async function handleSetupSubmit(formData: FormData, id: string) {
			// Show progress immediately, before any async work — otherwise the
			// form stays fully interactive through several awaits (including
			// PBKDF2 key derivation), long enough that a quick tap on Share
			// could still capture "/" as the install target instead of the
			// /d/:id this all ends up navigating to.
			view = { kind: "loading" }
			handle.update()

			const password = String(formData.get("password") ?? "")
			const data = createTrackingData(
				{
					dailyMinimum: readMinutes(
						formData,
						"dailyMinHours",
						"dailyMinMinutes",
					),
					dailyMax: readMinutes(formData, "dailyMaxHours", "dailyMaxMinutes"),
					dateFormat: (formData.get("dateFormat") as DateFormat | null) ?? "de",
				},
				id,
			)
			await saveTrackingData(data)
			sessionKey = await deriveTrackingKey(password)
			await saveSyncKey(sessionKey)

			await Promise.all([
				// Bounded: a real navigation kills any pending fetch anyway once
				// we leave, so don't let a hung request hold up setup
				// indefinitely. If the push hasn't landed by then, the next
				// Start/Stop/Buchen action retries it the same as any other
				// interrupted sync.
				Promise.race([syncEngine.sync(data, sessionKey), delay(2000)]),
				storePasswordCredential(data.id, password),
			])

			// Real navigation (not history.replaceState + in-place view swap)
			// so Safari/Chrome recognize this as a completed form submission
			// and offer to save the password — safe because saveSyncKey()
			// above already persisted what resolveView() needs to rehydrate
			// straight into the tracking view on the next load, no re-prompt.
			window.location.assign(`/d/${data.id}`)
		}

		async function handleUnlockSubmit(id: string, unlockPassword: string) {
			view = { kind: "loading" }
			handle.update()

			const response = await fetch(`/sync/${encodeURIComponent(id)}`)
			if (!response.ok) {
				view = { kind: "unlock", id, error: t("No data found for this link.") }
				handle.update()
				return
			}

			const serialized = (await response.json()) as SerializedEncryptedDocument
			const doc = deserializeEncryptedDocument(serialized)
			try {
				const syncKey = await deriveTrackingKey(unlockPassword, doc.salt)
				const data = await decryptTrackingData(doc, syncKey)
				await saveTrackingData(data)
				await saveSyncKey(syncKey)
			} catch {
				view = { kind: "unlock", id, error: t("Wrong password.") }
				handle.update()
				return
			}

			// Real navigation, same reasoning as handleSetupSubmit above — safe
			// here too since saveSyncKey() already persisted what resolveView()
			// needs to rehydrate straight back into the tracking view.
			await storePasswordCredential(id, unlockPassword)
			window.location.reload()
		}

		async function handleSettingsSubmit(
			data: TrackingData,
			formData: FormData,
		) {
			data.settings = {
				dailyMinimum: readMinutes(formData, "dailyMinHours", "dailyMinMinutes"),
				dailyMax: readMinutes(formData, "dailyMaxHours", "dailyMaxMinutes"),
				dateFormat: (formData.get("dateFormat") as DateFormat | null) ?? "de",
			}
			await saveTrackingData(data)
			view = { kind: "home", data }
			handle.update()
			if (sessionKey) void syncEngine.sync(data, sessionKey)
		}

		async function handleStart(data: TrackingData) {
			data.blocks = startBlock(data.blocks, Math.floor(Date.now() / 1000))
			await saveTrackingData(data)
			handle.update()
			if (sessionKey) void syncEngine.sync(data, sessionKey)
		}

		async function handleStop(data: TrackingData) {
			data.blocks = stopBlock(data.blocks, Math.floor(Date.now() / 1000))
			await saveTrackingData(data)
			handle.update()
			if (sessionKey) void syncEngine.sync(data, sessionKey)
		}

		async function handleBlockFieldChange(
			data: TrackingData,
			index: number,
			field: "start" | "end",
			value: number | null,
		) {
			data.blocks = setBlockField(data.blocks, index, field, value)
			await saveTrackingData(data)
			handle.update()
			if (sessionKey) void syncEngine.sync(data, sessionKey)
		}

		async function handleBookDay(data: TrackingData, bookingSec: number) {
			const booked = bookDay(data, bookingSec, Math.floor(Date.now() / 1000))
			data.blocks = booked.blocks
			data.bookings = booked.bookings
			await saveTrackingData(data)
			handle.update()
			if (sessionKey) void syncEngine.sync(data, sessionKey)
		}

		// Example handlers mirror the real ones above but stay in-memory only —
		// no saveTrackingData, no syncToServer — since example data is strictly
		// throwaway (see app/utils/examples.ts).
		function handleExampleStart(data: TrackingData, now: Date) {
			data.blocks = startBlock(data.blocks, Math.floor(now.getTime() / 1000))
			handle.update()
		}

		function handleExampleStop(data: TrackingData, now: Date) {
			data.blocks = stopBlock(data.blocks, Math.floor(now.getTime() / 1000))
			handle.update()
		}

		function handleExampleBlockFieldChange(
			data: TrackingData,
			index: number,
			field: "start" | "end",
			value: number | null,
		) {
			data.blocks = setBlockField(data.blocks, index, field, value)
			handle.update()
		}

		function handleExampleBookDay(
			data: TrackingData,
			bookingSec: number,
			now: Date,
		) {
			const booked = bookDay(data, bookingSec, Math.floor(now.getTime() / 1000))
			data.blocks = booked.blocks
			data.bookings = booked.bookings
			handle.update()
		}

		return () => {
			if (view.kind === "loading")
				return (
					<div class="loading-screen" role="status" aria-label={t("Loading")}>
						<div class="spinner" aria-hidden="true" />
					</div>
				)

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
						<h1>ClockOut</h1>
						<p class="form-intro">
							{t("This browser doesn't have local data for this link.")}
						</p>
						{/* Not user-facing — lets password managers key the saved
						password to this specific doc instead of just the domain. */}
						<input
							class="sr-only"
							name="username"
							type="text"
							autoComplete="username"
							defaultValue={id}
							tabIndex={-1}
							aria-hidden="true"
						/>
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
				const { id } = view

				return (
					<form
						class="form-card"
						mix={on("submit", (event) => {
							event.preventDefault()
							void handleSetupSubmit(new FormData(event.currentTarget), id)
						})}
					>
						<h1>ClockOut</h1>

						<p class="form-intro">
							{t(
								"Set a password to encrypt your data before it's synced online — only you can unlock it. You'll only need to enter it again if your browser cache is cleared or you open the link to your ClockOut on another device. Recommendation: use a password manager!",
							)}
						</p>

						{/* Not user-facing — lets password managers key the saved
						password to this specific doc instead of just the domain,
						so a later visit to /d/:id (see the unlock form above)
						autofills the right one. */}
						<input
							class="sr-only"
							name="username"
							type="text"
							autoComplete="username"
							defaultValue={id}
							tabIndex={-1}
							aria-hidden="true"
						/>

						<label class="form-field">
							{t("Password")}
							<input
								name="password"
								type="password"
								autoComplete="new-password"
								required
								// This password is the only thing protecting synced data —
								// the server stores the ciphertext at an unauthenticated,
								// publicly reachable URL (see sync/controller.tsx) and never
								// checks it, so a weak password is the one remaining line of
								// defense against anyone who obtains that URL. Only enforced
								// here at creation, not on the unlock form — that must keep
								// accepting whatever password an existing doc was already set
								// up with.
								minLength={8}
								maxLength={128}
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
								minLength={8}
								maxLength={128}
								mix={on("input", (event) => {
									syncPasswordMatchValidity(event.currentTarget.form, t)
								})}
							/>
						</label>

						<fieldset>
							<legend>{t("Daily minimum")}</legend>
							<div class="hm-row">
								<input
									name="dailyMinHours"
									type="number"
									inputmode="numeric"
									min="0"
									max="23"
									defaultValue="7"
									aria-label={`${t("Daily minimum")} ${t("h")}`}
									mix={[
										on("focus", (event) => selectOnFocus(event.currentTarget)),
										on("mouseup", (event) =>
											reassertSelectOnMouseUp(event.currentTarget, event),
										),
									]}
								/>
								<span class="unit" aria-hidden="true">
									{t("h")}
								</span>
								<input
									name="dailyMinMinutes"
									type="number"
									inputmode="numeric"
									min="0"
									max="59"
									defaultValue="0"
									aria-label={`${t("Daily minimum")} ${t("m")}`}
									mix={[
										on("focus", (event) => selectOnFocus(event.currentTarget)),
										on("mouseup", (event) =>
											reassertSelectOnMouseUp(event.currentTarget, event),
										),
									]}
								/>
								<span class="unit" aria-hidden="true">
									{t("m")}
								</span>
							</div>
							<p class="field-hint">
								{t("Used to calculate your quitting time and depot credit.")}
							</p>
						</fieldset>

						<fieldset>
							<legend>{t("Daily max")}</legend>
							<div class="hm-row">
								<input
									name="dailyMaxHours"
									type="number"
									inputmode="numeric"
									min="0"
									max="23"
									defaultValue="9"
									aria-label={`${t("Daily max")} ${t("h")}`}
									mix={[
										on("focus", (event) => selectOnFocus(event.currentTarget)),
										on("mouseup", (event) =>
											reassertSelectOnMouseUp(event.currentTarget, event),
										),
									]}
								/>
								<span class="unit" aria-hidden="true">
									{t("h")}
								</span>
								<input
									name="dailyMaxMinutes"
									type="number"
									inputmode="numeric"
									min="0"
									max="59"
									defaultValue="55"
									aria-label={`${t("Daily max")} ${t("m")}`}
									mix={[
										on("focus", (event) => selectOnFocus(event.currentTarget)),
										on("mouseup", (event) =>
											reassertSelectOnMouseUp(event.currentTarget, event),
										),
									]}
								/>
								<span class="unit" aria-hidden="true">
									{t("m")}
								</span>
							</div>
							<p class="field-hint">
								{t(
									"The most that can be booked in one day — extra time still credits the depot.",
								)}
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

			if (view.kind === "home") {
				const { data } = view
				return (
					<div class="form-card">
						<h1>ClockOut</h1>
						<a href={`/d/${data.id}`} class="btn btn-primary">
							{t("Go to your time tracking")}
						</a>
						<button
							type="button"
							class="btn"
							mix={on("click", () => {
								view = { kind: "settings", data }
								handle.update()
							})}
						>
							{t("Settings")}
						</button>
					</div>
				)
			}

			if (view.kind === "settings") {
				const { data } = view
				const dailyMinHours = Math.floor(data.settings.dailyMinimum / 60)
				const dailyMinMinutes = data.settings.dailyMinimum % 60
				const dailyMaxHours = Math.floor(data.settings.dailyMax / 60)
				const dailyMaxMinutes = data.settings.dailyMax % 60

				return (
					<form
						class="form-card"
						mix={on("submit", (event) => {
							event.preventDefault()
							void handleSettingsSubmit(data, new FormData(event.currentTarget))
						})}
					>
						<h1>{t("Settings")}</h1>

						<fieldset>
							<legend>{t("Daily minimum")}</legend>
							<div class="hm-row">
								<input
									name="dailyMinHours"
									type="number"
									inputmode="numeric"
									min="0"
									max="23"
									defaultValue={String(dailyMinHours)}
									aria-label={`${t("Daily minimum")} ${t("h")}`}
									mix={[
										on("focus", (event) => selectOnFocus(event.currentTarget)),
										on("mouseup", (event) =>
											reassertSelectOnMouseUp(event.currentTarget, event),
										),
									]}
								/>
								<span class="unit" aria-hidden="true">
									{t("h")}
								</span>
								<input
									name="dailyMinMinutes"
									type="number"
									inputmode="numeric"
									min="0"
									max="59"
									defaultValue={String(dailyMinMinutes)}
									aria-label={`${t("Daily minimum")} ${t("m")}`}
									mix={[
										on("focus", (event) => selectOnFocus(event.currentTarget)),
										on("mouseup", (event) =>
											reassertSelectOnMouseUp(event.currentTarget, event),
										),
									]}
								/>
								<span class="unit" aria-hidden="true">
									{t("m")}
								</span>
							</div>
							<p class="field-hint">
								{t("Used to calculate your quitting time and depot credit.")}
							</p>
						</fieldset>

						<fieldset>
							<legend>{t("Daily max")}</legend>
							<div class="hm-row">
								<input
									name="dailyMaxHours"
									type="number"
									inputmode="numeric"
									min="0"
									max="23"
									defaultValue={String(dailyMaxHours)}
									aria-label={`${t("Daily max")} ${t("h")}`}
									mix={[
										on("focus", (event) => selectOnFocus(event.currentTarget)),
										on("mouseup", (event) =>
											reassertSelectOnMouseUp(event.currentTarget, event),
										),
									]}
								/>
								<span class="unit" aria-hidden="true">
									{t("h")}
								</span>
								<input
									name="dailyMaxMinutes"
									type="number"
									inputmode="numeric"
									min="0"
									max="59"
									defaultValue={String(dailyMaxMinutes)}
									aria-label={`${t("Daily max")} ${t("m")}`}
									mix={[
										on("focus", (event) => selectOnFocus(event.currentTarget)),
										on("mouseup", (event) =>
											reassertSelectOnMouseUp(event.currentTarget, event),
										),
									]}
								/>
								<span class="unit" aria-hidden="true">
									{t("m")}
								</span>
							</div>
							<p class="field-hint">
								{t(
									"The most that can be booked in one day — extra time still credits the depot.",
								)}
							</p>
						</fieldset>

						<div class="form-field">
							<label class="form-field">
								{t("Date format")}
								<select
									name="dateFormat"
									defaultValue={data.settings.dateFormat ?? "de"}
								>
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
							{t("Save")}
						</button>
						<button
							type="button"
							class="btn"
							mix={on("click", () => {
								view = { kind: "home", data }
								handle.update()
							})}
						>
							{t("Cancel")}
						</button>
					</form>
				)
			}

			if (view.kind === "tracking") {
				const { data } = view
				return (
					<TrackingScreen
						data={data}
						now={new Date()}
						onStart={() => void handleStart(data)}
						onStop={() => void handleStop(data)}
						onBlockFieldChange={(index, field, value) =>
							void handleBlockFieldChange(data, index, field, value)
						}
						onBookDay={(bookingSec) => void handleBookDay(data, bookingSec)}
						t={t}
						footer={
							syncStatusLabel(syncEngine.getStatus(), t) && (
								<p class="sync-status" role="status">
									{syncEngine.getStatus() === "syncing" && (
										<span class="spinner" aria-hidden="true" />
									)}
									{syncStatusLabel(syncEngine.getStatus(), t)}
								</p>
							)
						}
					/>
				)
			}

			const { data, example, offsetMs } = view
			const now = new Date(Date.now() + offsetMs)
			const dateTime = `${formatWeekdayName(now, data.settings.dateFormat, "long")}, ${formatClockTime(now, data.settings.dateFormat)}`

			return (
				<TrackingScreen
					data={data}
					now={now}
					onStart={() => handleExampleStart(data, now)}
					onStop={() => handleExampleStop(data, now)}
					onBlockFieldChange={(index, field, value) =>
						handleExampleBlockFieldChange(data, index, field, value)
					}
					onBookDay={(bookingSec) =>
						handleExampleBookDay(data, bookingSec, now)
					}
					t={t}
					banner={
						<p class="time-banner" role="status">
							{t(
								'Demo: simulating "{name}" — {dateTime}. Nothing here is saved.',
								{ name: t(example.title), dateTime },
							)}{" "}
							<a href="/about">{t("Back to examples")}</a>
						</p>
					}
				/>
			)
		}
	},
)

type TrackingScreenProps = {
	data: TrackingData
	now: Date
	onStart: () => void
	onStop: () => void
	onBlockFieldChange: (
		index: number,
		field: "start" | "end",
		value: number | null,
	) => void
	onBookDay: (bookingSec: number) => void
	t: Translator
	banner?: RemixNode
	footer?: RemixNode
}

function TrackingScreen(handle: Handle<TrackingScreenProps>) {
	return () => {
		const {
			data,
			now,
			onStart,
			onStop,
			onBlockFieldChange,
			onBookDay,
			t,
			banner,
			footer,
		} = handle.props
		const nowSec = Math.floor(now.getTime() / 1000)
		const summary = summarize(data, now)
		const dateFormat = data.settings.dateFormat

		const defaultBookingMinutes = Math.round(summary.defaultBookingSec / 60)
		const defaultBookingHours = Math.floor(defaultBookingMinutes / 60)
		const defaultBookingRemainderMinutes = defaultBookingMinutes % 60

		return (
			<div class="time-page">
				{banner}
				<div class="time-stats">
					<p class="time-stat time-stat--primary">
						{t("Quitting time: {time}", {
							time: formatClockTime(
								new Date(summary.quittingTimeSec * 1000),
								dateFormat,
							),
						})}
					</p>
					<p class="time-stat time-stat--secondary">
						{t("Depot: {duration}", {
							duration: formatDuration(summary.depotSec),
						})}
					</p>
				</div>
				<ul class="block-list">
					{data.blocks.map((block: Block, i: number) => (
						<li key={i} class="data-row block-row">
							<div class="hm-row">
								<input
									key={`start-${i}-${block.start ?? "empty"}`}
									type="time"
									aria-label={t("Start")}
									defaultValue={timeInputValue(block.start)}
									mix={on("change", (event) => {
										onBlockFieldChange(
											i,
											"start",
											parseTimeInput(event.currentTarget.value, nowSec),
										)
									})}
								/>
								<span aria-hidden="true">–</span>
								<input
									key={`end-${i}-${block.end ?? "empty"}`}
									type="time"
									aria-label={t("End")}
									disabled={block.start === null}
									defaultValue={timeInputValue(block.end)}
									mix={on("change", (event) => {
										onBlockFieldChange(
											i,
											"end",
											parseTimeInput(event.currentTarget.value, nowSec),
										)
									})}
								/>
							</div>
							{block.start !== null && block.end !== null && (
								<span class="block-duration">
									{formatDuration(blockDurationSec(block, nowSec))}
								</span>
							)}
						</li>
					))}
				</ul>
				<button
					type="button"
					className="toggle-button"
					mix={on("click", summary.isRunning ? onStop : onStart)}
					data-running={summary.isRunning}
				>
					{summary.isRunning ? t("Stop") : t("Start")}
				</button>
				<form
					class="booking-form"
					mix={on("submit", (event) => {
						event.preventDefault()
						const formData = new FormData(event.currentTarget)
						onBookDay(
							readMinutes(formData, "bookingHours", "bookingMinutes") * 60,
						)
					})}
				>
					<fieldset>
						<legend>{t("Booking time")}</legend>
						<div class="hm-row">
							<input
								name="bookingHours"
								type="number"
								inputmode="numeric"
								min="0"
								max="23"
								defaultValue={String(defaultBookingHours)}
								aria-label={`${t("Booking time")} ${t("h")}`}
								mix={[
									on("focus", (event) => selectOnFocus(event.currentTarget)),
									on("mouseup", (event) =>
										reassertSelectOnMouseUp(event.currentTarget, event),
									),
								]}
							/>
							<span class="unit" aria-hidden="true">
								{t("h")}
							</span>
							<input
								name="bookingMinutes"
								type="number"
								inputmode="numeric"
								min="0"
								max="59"
								defaultValue={String(defaultBookingRemainderMinutes)}
								aria-label={`${t("Booking time")} ${t("m")}`}
								mix={[
									on("focus", (event) => selectOnFocus(event.currentTarget)),
									on("mouseup", (event) =>
										reassertSelectOnMouseUp(event.currentTarget, event),
									),
								]}
							/>
							<span class="unit" aria-hidden="true">
								{t("m")}
							</span>
						</div>
					</fieldset>
					<button type="submit" class="btn btn-primary">
						{t("Book")}
					</button>
				</form>
				{footer}
			</div>
		)
	}
}
