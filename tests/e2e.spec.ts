import { expect, test } from "@playwright/test"

test("home page loads the setup form", async ({ page }) => {
	await page.goto("/")
	await expect(page.locator("h1")).toHaveText("ClockOut")
	await expect(
		page.getByRole("button", { name: "Save and start tracking" }),
	).toBeVisible()
})

test("setup creates tracking data, toggling persists across reload", async ({
	page,
}) => {
	await page.goto("/")
	await page.getByLabel("Password", { exact: true }).fill("correct horse")
	await page.getByLabel("Repeat password").fill("correct horse")
	await page.getByRole("button", { name: "Save and start tracking" }).click()

	await expect(page).toHaveURL(/\/d\//)
	const toggle = page.getByRole("button", { name: "Start" })
	await expect(toggle).toBeVisible()

	await toggle.click()
	await expect(page.getByRole("button", { name: "Stop" })).toBeVisible()

	await page.reload()
	await expect(page.getByRole("button", { name: "Stop" })).toBeVisible()

	// The reload must have rehydrated the sync key from IndexedDB, not just
	// the plaintext tracking data — otherwise this edit would silently stop
	// pushing to the server until the password is re-entered.
	await page.getByRole("button", { name: "Stop" }).click()
	await expect(page.getByRole("status")).toHaveText("Synced")
	await expect(page.getByRole("button", { name: "Start" })).toBeVisible()
})

test("a stale dangling start hides the toggle until catch-up is resolved", async ({
	page,
}) => {
	await page.goto("/example/forgot-stop-friday")

	// Friday's session was left open days ago — nothing live to "Stop", so
	// the toggle must stay hidden rather than let a click silently close
	// that whole gap out as one bogus multi-day session.
	await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0)
	await expect(page.getByRole("button", { name: "Start" })).toHaveCount(0)

	const fieldsets = page.locator("fieldset")
	await fieldsets.nth(0).getByRole("spinbutton").first().fill("8")
	await page.getByRole("button", { name: "Save hours" }).click()

	await expect(page.getByRole("button", { name: "Start" })).toBeVisible()
})
