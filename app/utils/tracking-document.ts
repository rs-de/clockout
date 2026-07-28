import {
	decrypt,
	deriveKey,
	encrypt,
	fromBase64,
	randomSalt,
	toBase64,
} from "./crypto.ts"
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

type TrackingPayload = Pick<TrackingData, "settings" | "blocks" | "bookings">

/** A password-derived key, cached so repeat syncs skip re-running PBKDF2. */
export type TrackingSyncKey = { key: CryptoKey; salt: Uint8Array<ArrayBuffer> }

/** Only needed once per document: at setup (fresh salt) or unlock (server's salt). */
export async function deriveTrackingKey(
	password: string,
	salt: Uint8Array<ArrayBuffer> = randomSalt(),
): Promise<TrackingSyncKey> {
	return { key: await deriveKey(password, salt), salt }
}

/** Encrypts with an already-derived key — see `deriveTrackingKey`. */
export async function encryptTrackingData(
	data: TrackingData,
	syncKey: TrackingSyncKey,
): Promise<EncryptedTrackingDocument> {
	const payload: TrackingPayload = {
		settings: data.settings,
		blocks: data.blocks,
		bookings: data.bookings,
	}
	const { iv, ciphertext } = await encrypt(JSON.stringify(payload), syncKey.key)
	return { id: data.id, salt: syncKey.salt, iv, ciphertext }
}

/** Decrypts with an already-derived key — pass `deriveTrackingKey(password, doc.salt)`. */
export async function decryptTrackingData(
	doc: EncryptedTrackingDocument,
	syncKey: TrackingSyncKey,
): Promise<TrackingData> {
	const plaintext = await decrypt(doc.ciphertext, doc.iv, syncKey.key)
	const payload = JSON.parse(plaintext) as TrackingPayload
	return {
		id: doc.id,
		settings: payload.settings,
		blocks: payload.blocks,
		bookings: payload.bookings,
	}
}

/** JSON-safe wire/storage form of an EncryptedTrackingDocument. */
export type SerializedEncryptedDocument = {
	id: string
	salt: string
	iv: string
	ciphertext: string
}

export function serializeEncryptedDocument(
	doc: EncryptedTrackingDocument,
): SerializedEncryptedDocument {
	return {
		id: doc.id,
		salt: toBase64(doc.salt),
		iv: toBase64(doc.iv),
		ciphertext: toBase64(doc.ciphertext),
	}
}

export function deserializeEncryptedDocument(
	doc: SerializedEncryptedDocument,
): EncryptedTrackingDocument {
	return {
		id: doc.id,
		salt: fromBase64(doc.salt),
		iv: fromBase64(doc.iv),
		ciphertext: fromBase64(doc.ciphertext),
	}
}
