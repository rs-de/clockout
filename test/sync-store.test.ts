import assert from "node:assert/strict"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, test } from "node:test"

import { createSyncStore } from "../app/data/sync-store.server.ts"

const DOC = { id: "abc123", salt: "c2FsdA==", iv: "aXY=", ciphertext: "Y3Q=" }

describe("sync-store", () => {
	let dataDir: string

	beforeEach(async () => {
		dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "clockout-sync-"))
	})

	afterEach(async () => {
		await fs.rm(dataDir, { recursive: true, force: true })
	})

	test("returns undefined for a document that was never written", async () => {
		const store = createSyncStore(dataDir)
		assert.equal(await store.read("missing"), undefined)
	})

	test("round-trips a written document", async () => {
		const store = createSyncStore(dataDir)
		await store.write(DOC)
		assert.deepEqual(await store.read(DOC.id), DOC)
	})

	test("overwrites a document written under the same id", async () => {
		const store = createSyncStore(dataDir)
		await store.write(DOC)
		const updated = { ...DOC, ciphertext: "dXBkYXRlZA==" }
		await store.write(updated)
		assert.deepEqual(await store.read(DOC.id), updated)
	})

	test("creates the data directory on first write", async () => {
		const nested = path.join(dataDir, "nested", "dir")
		const store = createSyncStore(nested)
		await store.write(DOC)
		assert.deepEqual(await store.read(DOC.id), DOC)
	})

	test("rejects an id that isn't a safe filename (path traversal guard)", async () => {
		const store = createSyncStore(dataDir)
		await assert.rejects(() => store.write({ ...DOC, id: "../../etc/passwd" }))
		await assert.rejects(() => store.read("../../etc/passwd"))
	})
})
