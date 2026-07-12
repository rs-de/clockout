import type { TrackingData } from "./time-tracking.ts"

const DB_NAME = "clockout"
const STORE_NAME = "tracking-data"
const RECORD_KEY = "current"

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 1)
		request.onupgradeneeded = () => {
			request.result.createObjectStore(STORE_NAME)
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
		const tx = db.transaction(STORE_NAME, "readwrite")
		tx.objectStore(STORE_NAME).delete(RECORD_KEY)
		tx.oncomplete = () => resolve()
		tx.onerror = () => reject(tx.error)
	})
	db.close()
}
