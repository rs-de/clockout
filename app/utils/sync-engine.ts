import type { TrackingData } from "./time-tracking.ts"
import {
	encryptTrackingData,
	serializeEncryptedDocument,
	type TrackingSyncKey,
} from "./tracking-document.ts"

export type SyncStatus = "idle" | "syncing" | "synced" | "error"

const RETRY_START_MS = 3_000
const RETRY_MAX_MS = 30_000

export type SyncEngine = {
	getStatus(): SyncStatus
	/**
	 * Encrypts and PUTs the current document. Safe to call on every edit —
	 * bursts coalesce to the latest state: a new call aborts whichever
	 * request is still in flight, and a response is only trusted as "synced"
	 * if no newer call has superseded it since.
	 *
	 * Returns a promise that resolves once this attempt settles (success,
	 * failure, or superseded) — most callers fire-and-forget it same as
	 * before, but setup awaits it once to know the first push landed before
	 * navigating away. Never rejects: failures are handled internally.
	 */
	sync(data: TrackingData, syncKey: TrackingSyncKey): Promise<void>
	/** Wires the online-triggered retry. Call once; torn down via `signal`. */
	init(signal: AbortSignal): void
}

export function createSyncEngine(onUpdate: () => void): SyncEngine {
	let status: SyncStatus = "idle"
	let dirty = false
	let gen = 0
	let abortController: AbortController | null = null
	let retryDelay = RETRY_START_MS
	let retryTimer: ReturnType<typeof setTimeout> | null = null
	let pending: { data: TrackingData; syncKey: TrackingSyncKey } | null = null
	let engineSignal: AbortSignal | null = null

	function clearRetry() {
		if (retryTimer !== null) {
			clearTimeout(retryTimer)
			retryTimer = null
		}
		retryDelay = RETRY_START_MS
	}

	// Timers get throttled/paused in backgrounded tabs, so this alone can't be
	// relied on for prompt retries — the `online` listener in init() and a
	// future retry-on-resume are what actually catch those cases.
	function scheduleRetry() {
		if (retryTimer !== null || engineSignal?.aborted) return
		if (typeof navigator !== "undefined" && !navigator.onLine) return
		retryTimer = setTimeout(() => {
			retryTimer = null
			if (pending) void run(pending.data, pending.syncKey)
		}, retryDelay)
		retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS)
	}

	async function run(data: TrackingData, syncKey: TrackingSyncKey) {
		const ownGen = ++gen
		dirty = true
		pending = { data, syncKey }
		abortController?.abort()
		const ownController = new AbortController()
		abortController = ownController
		status = "syncing"
		onUpdate()

		try {
			const doc = await encryptTrackingData(data, syncKey)
			const response = await fetch(`/sync/${encodeURIComponent(data.id)}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(serializeEncryptedDocument(doc)),
				signal: ownController.signal,
			})
			if (!response.ok) throw new Error("Server error")
			// A newer call already owns dirty/retry/status if it superseded us.
			if (ownGen === gen) {
				dirty = false
				pending = null
				status = "synced"
				clearRetry()
			}
		} catch {
			if (ownController.signal.aborted) return // superseded, not a failure
			status = "error"
			scheduleRetry()
		}
		onUpdate()
	}

	return {
		getStatus: () => status,
		sync(data, syncKey) {
			return run(data, syncKey)
		},
		init(signal) {
			engineSignal = signal
			signal.addEventListener("abort", () => clearRetry())
			window.addEventListener(
				"online",
				() => {
					clearRetry()
					if (dirty && pending) void run(pending.data, pending.syncKey)
				},
				{ signal },
			)
		},
	}
}
