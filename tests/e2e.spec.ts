import { test as base, expect, type Page } from "@playwright/test"

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

async function setUpTracking(page: Page, password = "correct horse battery") {
	await page.goto("/")
	await page.getByLabel("Password", { exact: true }).fill(password)
	await page.getByLabel("Repeat password").fill(password)
	await page.getByRole("button", { name: "Save and start tracking" }).click()
	await expect(page).toHaveURL(/\/d\//)
	await expect(page.getByRole("button", { name: "Start" })).toBeVisible()
}

/** Fills a block's start/end via its time inputs (not the Start/Stop
 * buttons) — the buttons stamp the real current time, so completing a
 * multi-hour session through them would mean actually waiting hours. The
 * block-editing form has its own always-visible "Save" submit button,
 * standard HTML form structure — no focus-tracking or dynamic swapping. */
async function fillBlock(
	page: Page,
	index: number,
	start: string,
	end: string,
) {
	const rows = page.locator(".block-list li")
	const rowsBefore = await rows.count()
	const startInput = page.locator('input[aria-label="Start"]').nth(index)
	await startInput.fill(start)
	const endInput = page.locator('input[aria-label="End"]').nth(index)
	await endInput.fill(end)
	await page.getByRole("button", { name: "Save" }).click()
	// handleBlockFormSubmit's save is fire-and-forget (app.tsx) — wait for
	// the completed block's trailing empty row to actually appear (proof
	// data.blocks re-rendered from the saved state, which only happens
	// after saveTrackingData() resolves) before returning, so a caller
	// relying on the committed data (worked time, depot, a reload) can't
	// race ahead of the write reaching IndexedDB.
	await expect(rows).toHaveCount(rowsBefore + 1)
}

test("home page loads the setup form", async ({ page }) => {
	await page.goto("/")
	await expect(page.locator("h1")).toHaveText("ClockOut")
	await expect(page.getByText("Daily minimum")).toBeVisible()
	await expect(page.getByText("Daily max")).toBeVisible()
	await expect(
		page.getByRole("button", { name: "Save and start tracking" }),
	).toBeVisible()
})

test("setup creates tracking data; Start persists a block across reload", async ({
	page,
}) => {
	await setUpTracking(page)

	await page.getByRole("button", { name: "Start" }).click()
	await expect(page.getByRole("button", { name: "Stop" })).toBeVisible()
	await expect(
		page.locator('input[aria-label="Start"]').first(),
	).not.toHaveValue("")

	await page.reload()
	await expect(page.getByRole("button", { name: "Stop" })).toBeVisible()

	// The reload must have rehydrated the sync key from IndexedDB, not just
	// the plaintext tracking data — otherwise this edit would silently stop
	// pushing to the server until the password is re-entered.
	await page.getByRole("button", { name: "Stop" }).click()
	await expect(page.getByRole("status")).toHaveText("Synced")
})

test("a session shorter than a minute is discarded instead of closing the block", async ({
	page,
}) => {
	await setUpTracking(page)

	await page.getByRole("button", { name: "Start" }).click()
	await page.getByRole("button", { name: "Stop" }).click()

	// Back to Start, and the block is empty again — as if it never happened.
	await expect(page.getByRole("button", { name: "Start" })).toBeVisible()
	await expect(page.locator('input[aria-label="Start"]').first()).toHaveValue(
		"",
	)
})

test("completing a block auto-appends a new one, and Buchen banks the max-overflow to the depot", async ({
	page,
}) => {
	await setUpTracking(page)

	await fillBlock(page, 0, "07:00", "18:00")

	await expect(page.locator(".block-list li")).toHaveCount(2)
	await expect(page.getByText("Depot: 0h 00m")).toBeVisible()

	// 11h worked, but the booking field caps at the 9h55m daily max —
	// submitting it banks exactly the unbookable 1h05m overflow (time
	// between the 7h minimum and the max is booked as-is, not banked).
	await expect(page.locator('input[name="bookingHours"]')).toHaveValue("9")
	await expect(page.locator('input[name="bookingMinutes"]')).toHaveValue("55")
	await expect(page.getByText("Depot after booking: 1h 05m")).toBeVisible()
	await page.getByRole("button", { name: "Book" }).click()

	await expect(page.getByText("Depot: 1h 05m")).toBeVisible()
	// Booking resets the day: back to a single empty block.
	await expect(page.locator(".block-list li")).toHaveCount(1)
	await expect(page.locator('input[aria-label="Start"]').first()).toHaveValue(
		"",
	)
})

test("quitting time freezes once the minimum is covered and tracking stops, instead of drifting", async ({
	page,
}) => {
	await setUpTracking(page)

	// Exactly the 7h daily minimum, no depot involved — worked alone covers
	// it, and the block is then closed (not running).
	await fillBlock(page, 0, "09:00", "16:00")

	const stat = page.locator(".time-stat--primary")
	const textAfterSave = await stat.textContent()
	// The 1s live-tick interval (app.tsx) re-renders this every second;
	// confirm the text stays exactly the same instead of drifting with real
	// time now that tracking has stopped.
	await page.waitForTimeout(3000)
	await expect(stat).toHaveText(textAfterSave ?? "")
})

test("booking time can't exceed the daily max; native validation blocks submit", async ({
	page,
}) => {
	await setUpTracking(page)

	// Worked well past the daily max, so the max itself — not worked time —
	// is the binding ceiling this test is exercising.
	await fillBlock(page, 0, "07:00", "18:00")

	const bookingHours = page.locator('input[name="bookingHours"]')
	const bookingMinutes = page.locator('input[name="bookingMinutes"]')
	await bookingHours.fill("10")
	await bookingMinutes.fill("0")
	await page.getByRole("button", { name: "Book" }).click()

	// Native constraint validation blocks the submit — the field keeps its
	// (invalid) value instead of the form resetting.
	await expect(bookingHours).toHaveValue("10")
	await expect(bookingHours).toHaveJSProperty(
		"validationMessage",
		"Booking time can't exceed 9h 55m.",
	)

	// Back within range: submit goes through (proven by the sync status
	// appearing — a blocked submit never fires handleBookDay/syncEngine.sync).
	await bookingHours.fill("9")
	await bookingMinutes.fill("55")
	await page.getByRole("button", { name: "Book" }).click()
	await expect(page.getByRole("status")).toHaveText("Synced")
})

test("a short day's booking time is topped up from the depot, capped at what's available", async ({
	page,
}) => {
	await setUpTracking(page)

	// Bank 1h05m of depot: 11h worked, only 9h55m of it fits the daily max.
	await fillBlock(page, 0, "07:00", "18:00")
	await page.getByRole("button", { name: "Book" }).click()
	await expect(page.getByText("Depot: 1h 05m")).toBeVisible()

	// A short 2h day next — reload so the booking field's default (only set
	// via defaultValue at mount) actually reflects the fresh state, the same
	// way a real user would see it after reopening the app.
	await fillBlock(page, 0, "09:00", "11:00")
	await page.reload()

	const bookingHours = page.locator('input[name="bookingHours"]')
	const bookingMinutes = page.locator('input[name="bookingMinutes"]')
	// Topped up to 2h worked + the 1h05m banked depot = 3h05m, not just the
	// 2h actually worked.
	await expect(bookingHours).toHaveValue("3")
	await expect(bookingMinutes).toHaveValue("5")

	// Can't stretch further than what the depot actually covers.
	await bookingHours.fill("4")
	await expect(bookingHours).toHaveJSProperty(
		"validationMessage",
		"Booking time can't exceed 3h 05m.",
	)

	// Booking the topped-up 3h05m draws the depot back down to 0 — none of
	// the borrowed time was actually worked, so nothing offsets it.
	await bookingHours.fill("3")
	await bookingMinutes.fill("5")
	await expect(page.getByText("Depot after booking: 0h 00m")).toBeVisible()
	await page.getByRole("button", { name: "Book" }).click()
	await expect(page.getByText("Depot: 0h 00m")).toBeVisible()
})

test("clicking the logo from an example re-resolves the view instead of freezing it", async ({
	page,
}) => {
	// / and /example/:id both render the same top-level <App>, so a soft
	// (frame) navigation between them reuses the same component instance
	// instead of remounting it — the URL-based view must be re-resolved
	// explicitly on navigation, or the page keeps showing the example after
	// the URL has already moved on.
	await page.goto("/example/lunch-break")
	await expect(page.getByText('Demo: simulating "Lunch break"')).toBeVisible()

	await page.click(".app-nav__brand-wrapper a")

	await expect(page).toHaveURL(/\/$/)
	await expect(page.getByText(/Demo: simulating/)).toHaveCount(0)
	await expect(
		page.getByRole("button", { name: "Save and start tracking" }),
	).toBeVisible()
})

test("an example shows its scenario's quitting time and depot, and never syncs", async ({
	page,
}) => {
	await page.goto("/example/depot-credit")
	await expect(page.getByText("Depot: 3h 00m")).toBeVisible()
	await expect(page.getByText(/Quitting time: \d{2}:\d{2}/)).toBeVisible()
	// Example data is in-memory only — no sync status ever appears.
	await expect(page.getByRole("status", { name: /Sync|Synced/ })).toHaveCount(0)
})

test("a past quitting time switches to past tense and a warning color", async ({
	page,
}) => {
	await page.goto("/example/depot-credit")
	const stat = page.locator(".time-stat--primary")
	await expect(stat).toHaveAttribute("data-past", "false")
	await expect(stat).toHaveCSS("color", "rgb(11, 104, 203)")

	await page.goto("/example/past-quitting-time")
	await expect(stat).toHaveText(/Quitting time was: \d{2}:\d{2}/)
	await expect(stat).toHaveAttribute("data-past", "true")
	await expect(stat).toHaveCSS("color", "rgb(154, 103, 0)")
})

test("home shows a link to the existing doc, not the tracking screen directly", async ({
	page,
}) => {
	await setUpTracking(page)
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

test("home offers a settings link that edits and persists daily minimum/max", async ({
	page,
}) => {
	await setUpTracking(page)

	// Soft-navigate back to / (same reasoning as the logo/home tests above),
	// where settings editing is offered.
	await page.goto("/")
	await page.getByRole("button", { name: "Settings" }).click()

	const dailyMinHours = page.locator('input[name="dailyMinHours"]')
	await expect(dailyMinHours).toHaveValue("7")
	await dailyMinHours.fill("6")
	await page.getByRole("button", { name: "Save" }).click()

	// Back on home; reopening settings must show the persisted value, not
	// the default — proves the save actually reached IndexedDB rather than
	// just updating in-memory view state.
	const homeLink = page.getByRole("link", { name: "Go to your time tracking" })
	await expect(homeLink).toBeVisible()
	await page.getByRole("button", { name: "Settings" }).click()
	await expect(dailyMinHours).toHaveValue("6")

	await page.getByRole("button", { name: "Cancel" }).click()
	await expect(homeLink).toBeVisible()
})

test("clearing local storage requires re-entering the password to unlock", async ({
	page,
}) => {
	await setUpTracking(page)
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
	await page.getByLabel("Password").fill("correct horse battery")
	await page.getByRole("button", { name: "Unlock" }).click()
	await expect(page).toHaveURL(docUrl)
	await expect(
		page.getByRole("button", { name: /^(Start|Stop)$/ }),
	).toBeVisible()
})

test("pre-rewrite local data (weekly target + event log, no blocks/bookings) starts fresh instead of crashing", async ({
	page,
}) => {
	const id = "legacy-doc"

	// A real v0.2.5 client's IndexedDB record — before the day/block/depot
	// rewrite, `tracking-data` held `{ settings: { weeklyTargetMin }, events }`
	// with no `blocks`/`bookings` at all.
	await page.goto("/")
	await page.evaluate(
		(docId) =>
			new Promise<void>((resolve, reject) => {
				const request = indexedDB.open("clockout", 2)
				request.onupgradeneeded = () => {
					const db = request.result
					if (!db.objectStoreNames.contains("tracking-data")) {
						db.createObjectStore("tracking-data")
					}
					if (!db.objectStoreNames.contains("sync-key")) {
						db.createObjectStore("sync-key")
					}
				}
				request.onsuccess = () => {
					const db = request.result
					const tx = db.transaction("tracking-data", "readwrite")
					tx.objectStore("tracking-data").put(
						{
							id: docId,
							settings: { weeklyTargetMin: 35 * 60, dailyMax: 9 * 60 + 55 },
							events: [{ t: 1700000000, type: "start" }],
						},
						"current",
					)
					tx.oncomplete = () => resolve()
					tx.onerror = () => reject(tx.error)
				}
				request.onerror = () => reject(request.error)
			}),
		id,
	)

	await page.goto(`/d/${id}`)
	await expect(page.getByRole("button", { name: "Start" })).toBeVisible()
	await expect(
		page.getByText(
			"This update couldn't carry over your history — starting fresh from today.",
		),
	).toBeVisible()
})
