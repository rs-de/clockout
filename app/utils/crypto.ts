const PBKDF2_ITERATIONS = 250_000
const SALT_LENGTH_BYTES = 16
const IV_LENGTH_BYTES = 12

export function randomSalt(): Uint8Array<ArrayBuffer> {
	return crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES))
}

/** Derives an AES-GCM key from a password; never leaves this as the raw password. */
export async function deriveKey(
	password: string,
	salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
	const baseKey = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(password),
		"PBKDF2",
		false,
		["deriveKey"],
	)
	return crypto.subtle.deriveKey(
		{ name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
		baseKey,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	)
}

export async function encrypt(
	plaintext: string,
	key: CryptoKey,
): Promise<{
	iv: Uint8Array<ArrayBuffer>
	ciphertext: Uint8Array<ArrayBuffer>
}> {
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES))
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		key,
		new TextEncoder().encode(plaintext),
	)
	return { iv, ciphertext: new Uint8Array(ciphertext) }
}

/** Throws if `key`/`iv` don't match the ciphertext (wrong password, tampering). */
export async function decrypt(
	ciphertext: Uint8Array<ArrayBuffer>,
	iv: Uint8Array<ArrayBuffer>,
	key: CryptoKey,
): Promise<string> {
	const plaintext = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv },
		key,
		ciphertext,
	)
	return new TextDecoder().decode(plaintext)
}

/** `btoa`/`atob` work on both Node and the browser, unlike `Buffer`. */
export function toBase64(bytes: Uint8Array<ArrayBuffer>): string {
	let binary = ""
	for (const byte of bytes) binary += String.fromCharCode(byte)
	return btoa(binary)
}

export function fromBase64(base64: string): Uint8Array<ArrayBuffer> {
	const binary = atob(base64)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
	return bytes
}
