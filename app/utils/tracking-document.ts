import { decrypt, deriveKey, encrypt, randomSalt } from "./crypto.ts"
import type { TrackingData } from "./time-tracking.ts"

/**
 * A TrackingData document as it's sent to/stored on the server. `id`, `salt`,
 * and `iv` aren't secret (id routes to the resource, salt/iv are needed to
 * re-derive the key and decrypt) — only the password is.
 */
export type EncryptedTrackingDocument = {
	id: string
	salt: Uint8Array<ArrayBuffer>
	iv: Uint8Array<ArrayBuffer>
	ciphertext: Uint8Array<ArrayBuffer>
}

type TrackingPayload = Pick<TrackingData, "settings" | "events">

export async function encryptTrackingData(
	data: TrackingData,
	password: string,
): Promise<EncryptedTrackingDocument> {
	const salt = randomSalt()
	const key = await deriveKey(password, salt)
	const payload: TrackingPayload = {
		settings: data.settings,
		events: data.events,
	}
	const { iv, ciphertext } = await encrypt(JSON.stringify(payload), key)
	return { id: data.id, salt, iv, ciphertext }
}

export async function decryptTrackingData(
	doc: EncryptedTrackingDocument,
	password: string,
): Promise<TrackingData> {
	const key = await deriveKey(password, doc.salt)
	const plaintext = await decrypt(doc.ciphertext, doc.iv, key)
	const payload = JSON.parse(plaintext) as TrackingPayload
	return { id: doc.id, settings: payload.settings, events: payload.events }
}
