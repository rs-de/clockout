import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { decrypt, deriveKey, encrypt, randomSalt } from "../app/utils/crypto.ts"

describe("crypto", () => {
	test("round-trips plaintext through encrypt/decrypt with the right password", async () => {
		const salt = randomSalt()
		const key = await deriveKey("correct horse battery staple", salt)

		const { iv, ciphertext } = await encrypt("hello, world", key)
		const plaintext = await decrypt(ciphertext, iv, key)

		assert.equal(plaintext, "hello, world")
	})

	test("produces a different salt each time", () => {
		assert.notDeepEqual(randomSalt(), randomSalt())
	})

	test("produces a different iv (ciphertext) each time, even for the same plaintext", async () => {
		const salt = randomSalt()
		const key = await deriveKey("correct horse battery staple", salt)

		const a = await encrypt("hello, world", key)
		const b = await encrypt("hello, world", key)

		assert.notDeepEqual(a.iv, b.iv)
		assert.notDeepEqual(a.ciphertext, b.ciphertext)
	})

	test("fails to decrypt with the wrong password", async () => {
		const salt = randomSalt()
		const key = await deriveKey("correct horse battery staple", salt)
		const wrongKey = await deriveKey("wrong password", salt)

		const { iv, ciphertext } = await encrypt("hello, world", key)

		await assert.rejects(() => decrypt(ciphertext, iv, wrongKey))
	})

	test("fails to decrypt with the wrong salt (different derived key)", async () => {
		const key = await deriveKey("correct horse battery staple", randomSalt())
		const otherKey = await deriveKey(
			"correct horse battery staple",
			randomSalt(),
		)

		const { iv, ciphertext } = await encrypt("hello, world", key)

		await assert.rejects(() => decrypt(ciphertext, iv, otherKey))
	})
})
