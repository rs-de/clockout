import { test as base, expect } from "@playwright/test"

// Every test gets a console guard for free via this `page` override — a
// warning or error (source-map issues, unhandled rejections, etc.) fails
// the test instead of silently passing, so browser-console cleanliness is a
// regression check, not something re-verified by hand on every change.
const test = base.extend({
	page: async ({ page }, use) => {
		const issues: string[] = []
		page.on("console", (msg) => {
			if (msg.type() === "warning" || msg.type() === "error") {
				issues.push(`${msg.type()}: ${msg.text()}`)
			}
		})
		page.on("pageerror", (err) => issues.push(`pageerror: ${err.message}`))

		await use(page)

		expect(issues, issues.join("\n")).toEqual([])
	},
})

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

test("editing an already-recorded day updates its total and the week's remaining time", async ({
	page,
}) => {
	await page.goto("/example/steady-week")

	const weekRemaining = page.getByText(/Week remaining:/)
	const weekRemainingBefore = await weekRemaining.textContent()

	// aria-label carries the day's date, which shifts week to week — match
	// on the stable prefix instead of the full label.
	await page.locator('[aria-label^="Edit "]').first().click()

	const hours = page.locator('input[name="hours"]')
	await expect(hours).toBeFocused()

	// Real keystrokes on top of the pre-filled default (8), not .fill() —
	// this is what actually exercises select-on-focus. Typing "6" must
	// *replace* the "8", not append to it (a prior bug typed "3" onto an
	// unselected "8" and got "38").
	await expect(hours).toHaveValue("8")
	await page.keyboard.type("6")
	await expect(hours).toHaveValue("6")
	await page.locator('input[name="minutes"]').fill("0")
	// The save button is a real submit bound to this row's form via the
	// `form` attribute — Enter in either field submits it natively, no
	// explicit click needed.
	await page.keyboard.press("Enter")

	await expect(page.locator(".week-list li").first()).toContainText("6h 00m")
	// Back to the read-only row: the edit control reappears, the save
	// button (and its inputs) are gone.
	await expect(page.locator('[aria-label^="Edit "]').first()).toBeVisible()
	await expect(hours).toHaveCount(0)
	// The freed-up 2 hours (8h -> 6h) must show up in the week's remaining
	// time automatically — this is the whole point of the event-sourced
	// "adjust" delta, not a value the UI computes and pushes separately.
	await expect(weekRemaining).not.toHaveText(weekRemainingBefore ?? "")
})

test("clicking the logo from an example re-resolves the view instead of freezing it", async ({
	page,
}) => {
	// / and /example/:id both render the same top-level <App>, so a soft
	// (frame) navigation between them reuses the same component instance
	// instead of remounting it — the URL-based view must be re-resolved
	// explicitly on navigation, or the page keeps showing the example after
	// the URL has already moved on.
	await page.goto("/example/steady-week")
	await expect(page.getByText('Demo: simulating "A steady week"')).toBeVisible()

	await page.click(".app-nav__brand-wrapper a")

	await expect(page).toHaveURL(/\/$/)
	await expect(page.getByText(/Demo: simulating/)).toHaveCount(0)
	await expect(
		page.getByRole("button", { name: "Save and start tracking" }),
	).toBeVisible()
})

test("home shows a link to the existing doc, not the tracking screen directly", async ({
	page,
}) => {
	await page.goto("/")
	await page.getByLabel("Password", { exact: true }).fill("correct horse")
	await page.getByLabel("Repeat password").fill("correct horse")
	await page.getByRole("button", { name: "Save and start tracking" }).click()
	await expect(page).toHaveURL(/\/d\//)
	const docUrl = page.url()

	// Simulate the same soft-navigation path as the logo: go elsewhere, then
	// back to / while local data already exists.
	await page.goto("/example/lunch-break")
	await page.click(".app-nav__brand-wrapper a")

	await expect(page).toHaveURL(/\/$/)
	const homeLink = page.getByRole("link", { name: "Go to your time tracking" })
	await expect(homeLink).toBeVisible()
	await expect(
		page.getByRole("button", { name: /^(Start|Stop)$/ }),
	).toHaveCount(0)

	await homeLink.click()
	await expect(page).toHaveURL(docUrl)
	await expect(
		page.getByRole("button", { name: /^(Start|Stop)$/ }),
	).toBeVisible()
})

test("clearing local storage requires re-entering the password to unlock", async ({
	page,
}) => {
	await page.goto("/")
	await page.getByLabel("Password", { exact: true }).fill("correct horse")
	await page.getByLabel("Repeat password").fill("correct horse")
	await page.getByRole("button", { name: "Save and start tracking" }).click()
	// Setup awaits its first sync push (or a 2s cap) before navigating, so by
	// the time the URL below actually changes, the server already has an
	// encrypted copy to unlock against.
	await expect(page).toHaveURL(/\/d\//)
	const docUrl = page.url()

	// Simulate a fresh browser / cleared cache: wipe the IndexedDB the sync
	// key and plaintext copy live in, then revisit the bookmarkable doc URL.
	await page.evaluate(
		() =>
			new Promise<void>((resolve, reject) => {
				const request = indexedDB.deleteDatabase("clockout")
				request.onsuccess = () => resolve()
				request.onerror = () => reject(request.error)
			}),
	)
	await page.goto(docUrl)
	await expect(
		page.getByText("This browser doesn't have local data for this link."),
	).toBeVisible()

	// A wrong password must surface an error, not silently fail or unlock.
	await page.getByLabel("Password").fill("wrong horse")
	await page.getByRole("button", { name: "Unlock" }).click()
	await expect(page.getByRole("alert")).toHaveText("Wrong password.")

	// The correct password re-derives the same sync key from the doc's salt
	// and decrypts the server copy back into the tracking view.
	await page.getByLabel("Password").fill("correct horse")
	await page.getByRole("button", { name: "Unlock" }).click()
	await expect(page).toHaveURL(docUrl)
	await expect(
		page.getByRole("button", { name: /^(Start|Stop)$/ }),
	).toBeVisible()
})
