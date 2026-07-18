import { expect, test } from "@playwright/test"

test("home page loads the setup form", async ({ page }) => {
	await page.goto("/")
	await expect(page.locator("h1")).toHaveText("clockout")
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

	await page.getByRole("button", { name: "Stop" }).click()
	await expect(page.getByRole("button", { name: "Start" })).toBeVisible()
})
