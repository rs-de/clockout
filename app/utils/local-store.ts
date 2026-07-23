import type { TrackingData } from "./time-tracking.ts"
import type { TrackingSyncKey } from "./tracking-document.ts"

const DB_NAME = "clockout"
const STORE_NAME = "tracking-data"
const SYNC_KEY_STORE_NAME = "sync-key"
const RECORD_KEY = "current"

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 2)
		request.onupgradeneeded = () => {
			const db = request.result
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME)
			}
			if (!db.objectStoreNames.contains(SYNC_KEY_STORE_NAME)) {
				db.createObjectStore(SYNC_KEY_STORE_NAME)
			}
		}
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error)
	})
}

/** Persists the single active TrackingData document, decrypted, for offline/reload durability. */
export async function saveTrackingData(data: TrackingData): Promise<void> {
	const db = await openDb()
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readwrite")
		tx.objectStore(STORE_NAME).put(data, RECORD_KEY)
		tx.oncomplete = () => resolve()
		tx.onerror = () => reject(tx.error)
	})
	db.close()
}

export async function loadTrackingData(): Promise<TrackingData | undefined> {
	const db = await openDb()
	const result = await new Promise<TrackingData | undefined>(
		(resolve, reject) => {
			const request = db
				.transaction(STORE_NAME, "readonly")
				.objectStore(STORE_NAME)
				.get(RECORD_KEY)
			request.onsuccess = () =>
				resolve(request.result as TrackingData | undefined)
			request.onerror = () => reject(request.error)
		},
	)
	db.close()
	return result
}

/** Only needed to recover from a corrupted/stale local copy; the server remains the backup (encrypted). */
export async function clearTrackingData(): Promise<void> {
	const db = await openDb()
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction([STORE_NAME, SYNC_KEY_STORE_NAME], "readwrite")
		tx.objectStore(STORE_NAME).delete(RECORD_KEY)
		tx.objectStore(SYNC_KEY_STORE_NAME).delete(RECORD_KEY)
		tx.oncomplete = () => resolve()
		tx.onerror = () => reject(tx.error)
	})
	db.close()
}

/**
 * Persists the derived sync key so re-opening the app never needs the
 * password again — only unlocking on a fresh browser/cleared storage does.
 * The key stays non-extractable across the round trip (verified: structured
 * clone preserves that), so this doesn't expose anything reload/devtools
 * couldn't already reach via the plaintext in `saveTrackingData`.
 */
export async function saveSyncKey(syncKey: TrackingSyncKey): Promise<void> {
	const db = await openDb()
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(SYNC_KEY_STORE_NAME, "readwrite")
		tx.objectStore(SYNC_KEY_STORE_NAME).put(syncKey, RECORD_KEY)
		tx.oncomplete = () => resolve()
		tx.onerror = () => reject(tx.error)
	})
	db.close()
}

export async function loadSyncKey(): Promise<TrackingSyncKey | undefined> {
	const db = await openDb()
	const result = await new Promise<TrackingSyncKey | undefined>(
		(resolve, reject) => {
			const request = db
				.transaction(SYNC_KEY_STORE_NAME, "readonly")
				.objectStore(SYNC_KEY_STORE_NAME)
				.get(RECORD_KEY)
			request.onsuccess = () =>
				resolve(request.result as TrackingSyncKey | undefined)
			request.onerror = () => reject(request.error)
		},
	)
	db.close()
	return result
}
