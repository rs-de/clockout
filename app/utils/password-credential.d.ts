// TypeScript's bundled DOM lib has dropped the Credential Management API
// entirely (no `Credential`, `PasswordCredential`, or `navigator.credentials`)
// — this is the minimal ambient surface app/ui/app.tsx needs to call
// navigator.credentials.store() for the setup/unlock password forms.
// Feature-detected at the call site; unsupported browsers never touch this.

interface Credential {
	readonly id: string
	readonly type: string
}

interface PasswordCredentialData {
	id: string
	password: string
	name?: string
	iconURL?: string
}

declare class PasswordCredential implements Credential {
	constructor(data: PasswordCredentialData)
	readonly id: string
	readonly type: string
	readonly password: string
	readonly name?: string
	readonly iconURL?: string
}

interface CredentialsContainer {
	store(credential: Credential): Promise<Credential>
}

interface Navigator {
	readonly credentials: CredentialsContainer
}
