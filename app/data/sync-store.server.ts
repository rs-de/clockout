import * as fs from "node:fs/promises"
import * as path from "node:path"

import type { SerializedEncryptedDocument } from "../utils/tracking-document.ts"

/**
 * Stores opaque encrypted blobs on disk, one file per document id. Never
 * touches crypto or plaintext — the server can't decrypt these, only the
 * password (which it never sees) can.
 */
export function createSyncStore(dataDir: string) {
	function fileFor(id: string): string {
		if (!/^[A-Za-z0-9_-]+$/.test(id))
			throw new Error(`Invalid document id: ${id}`)
		return path.join(dataDir, `${id}.json`)
	}

	return {
		async read(id: string): Promise<SerializedEncryptedDocument | undefined> {
			try {
				const raw = await fs.readFile(fileFor(id), "utf8")
				return JSON.parse(raw) as SerializedEncryptedDocument
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
				throw error
			}
		},

		async write(doc: SerializedEncryptedDocument): Promise<void> {
			await fs.mkdir(dataDir, { recursive: true })
			await fs.writeFile(fileFor(doc.id), JSON.stringify(doc))
		},
	}
}

export const syncStore = createSyncStore(
	process.env.CLOCKOUT_DATA_DIR ?? path.join(process.cwd(), "data", "sync"),
)
