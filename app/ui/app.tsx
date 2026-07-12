import { clientEntry, type Handle, on } from "remix/ui"

import { loadTrackingData, saveTrackingData } from "../utils/local-store.ts"
import {
	createTrackingData,
	formatDuration,
	isRunning,
	summarize,
	type TrackingData,
} from "../utils/time-tracking.ts"

type View =
	| { kind: "loading" }
	| { kind: "setup" }
	| { kind: "tracking"; data: TrackingData }

function readMinutes(
	formData: FormData,
	hoursField: string,
	minutesField: string,
): number {
	const hours = Number(formData.get(hoursField))
	const minutes = Number(formData.get(minutesField))
	return hours * 60 + minutes
}

export const App = clientEntry(import.meta.url, function App(handle: Handle) {
	let view: View = { kind: "loading" }
	let password = ""
	let passwordRepeat = ""

	handle.queueTask(async (signal) => {
		const data = await loadTrackingData()
		if (signal.aborted) return
		view = data ? { kind: "tracking", data } : { kind: "setup" }
		handle.update()
	})

	// Keeps the always-visible remaining time live. Browser-only: on the server
	// this timer would outlive the one-shot SSR render and crash the process.
	if (typeof window !== "undefined") {
		const interval = setInterval(() => handle.update(), 1000)
		handle.signal.addEventListener("abort", () => clearInterval(interval))
	}

	async function handleSetupSubmit(formData: FormData) {
		const data = createTrackingData({
			weeklyTargetMin: readMinutes(formData, "weeklyHours", "weeklyMinutes"),
			dailyMax: readMinutes(formData, "dailyHours", "dailyMinutes"),
		})
		await saveTrackingData(data)
		view = { kind: "tracking", data }
		handle.update()
	}

	async function handleToggle(data: TrackingData) {
		data.events.push({
			t: Math.floor(Date.now() / 1000),
			type: isRunning(data.events) ? "stop" : "start",
		})
		await saveTrackingData(data)
		handle.update()
	}

	return () => {
		if (view.kind === "loading") return <p>Loading...</p>

		if (view.kind === "setup") {
			const passwordsMatch = password.length > 0 && password === passwordRepeat

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
							type="password"
							autoComplete="new-password"
							required
							mix={on("input", (event) => {
								password = event.currentTarget.value
								handle.update()
							})}
						/>
					</label>

					<label>
						Repeat password
						<input
							type="password"
							autoComplete="new-password"
							required
							mix={on("input", (event) => {
								passwordRepeat = event.currentTarget.value
								handle.update()
							})}
						/>
					</label>

					{passwordRepeat.length > 0 && !passwordsMatch && (
						<p role="alert">Passwords don't match</p>
					)}

					<button type="submit" disabled={!passwordsMatch}>
						Speichern und los ...
					</button>
				</form>
			)
		}

		const { data } = view
		const summary = summarize(data)

		return (
			<div>
				<p>Week remaining: {formatDuration(summary.weeklyRemainingSec)}</p>
				<p>Day remaining: {formatDuration(summary.dailyRemainingSec)}</p>
				<button
					type="button"
					className="toggle-button"
					mix={on("click", () => void handleToggle(data))}
					data-running={summary.isRunning}
				>
					{summary.isRunning ? "Stop" : "Start"}
				</button>
			</div>
		)
	}
})
