# Engineering Paradigms Realized in clockout

Key properties of a well-built web application that this project embodies.

---

## 1. Validate on submit, not before — and stay stateless

A form shows no validation feedback at all until the user actually
attempts to submit, mirroring how a plain HTML form behaves with no
JavaScript: native constraint validation only fires at submission time,
not while typing. Constraints natively expressible in HTML (`required`,
`min`/`max`) are left entirely to the browser. For the one thing HTML
can't express — cross-field checks like a password-confirmation match —
the Constraint Validation API (`input.setCustomValidity(...)`) is used
instead of app state: the browser itself decides *when* to surface the
message (on submit attempt, exactly like `required`) and keeps it live as
the user fixes the field. No "has the user submitted yet" flag, no
manually rendered error paragraph — the validity lives entirely in the
DOM, not in the component.

## 2. Reserve one fixed slot below each field for hint/error text

Every form field's description text renders in the same place: directly
below its input (or input row) — never above it, never beside the label.
That slot is the one place feedback about the field ever appears, so if
a validation or sync error for that field is added later, it lands in a
slot the layout already reserves. Nothing above it shifts. A field
starts with the hint occupying that space, so the layout is never
"tighter" before an error appears than after.

Confirmed 2026-07-20: the setup form's per-field hints (`app/ui/app.tsx`,
`.field-hint` in `app/assets/app.css`) originally sat between the
`<legend>`/label and the input — the user asked for them to always sit
under the input instead, specifically so error feedback has a stable
home without the layout jumping when it appears.

The gap size itself must match everywhere too, not just the position.
`.field-hint`'s own top margin gave the right gap inside a `<fieldset>`
(no flex layout there), but the same margin *added to* the `.form-field`
wrapper's flex `gap` for the date-format field, making that one field's
hint sit visibly farther from its input than the rest. Fixed by zeroing
the margin specifically where the parent already supplies the gap
(`.form-field > .field-hint { margin-top: 0; }`) — one spacing mechanism
wins per context, they don't both apply to the same element.

## 3. Corrections are new events, not rewrites of history

`TrackingData.events` (`app/utils/time-tracking.ts`) has been append-only
from the start — `toggleTracking`/`resolveCatchup` only ever push new
`start`/`stop`/`skipDay` events, never mutate or delete one. When the
weekly-breakdown edit feature (2026-07-25) needed to let a user correct an
*already-recorded* day's total, the first draft broke that rule: it deleted
every event on that calendar day and rewrote a fresh pair. That's exactly
the kind of change event-sourcing is meant to rule out on sight — it looked
locally reasonable but was quietly unsafe the moment a day's events weren't
self-contained (a session chained past midnight from `resolveCatchup` has
its stop on the *next* calendar day; deleting "this day's events" would
have orphaned that stop, corrupting the neighboring day). It also meant
inventing a whole `isEditableDay` guard just to detect and forbid the
unsafe cases.

The fix was to stop rewriting anything. `editDay` appends a single signed
`"adjust"` event — the delta between the entered total and the day's
current total — anchored at that day's local midnight, and
`workedSecondsInRange` sums any `"adjust"` events whose own timestamp falls
in the queried range right alongside real start/stop overlap. Every
consumer (`weeklyBreakdown`, `summarize`'s daily/weekly totals) picks the
correction up automatically, with zero special-casing at any call site,
because they all already go through the one shared range-summing function.
This also deleted `isEditableDay` entirely: since nothing is rewritten,
there's no unsafe case left to detect — any day, no matter how its
existing events are shaped, can be corrected safely.

**The general shape**: modeling history as an ordered log of facts that
are only ever appended, never mutated or deleted, and letting every
derived value (a total, a "current state") be *computed* from that log
rather than stored and patched — the same principle applies whether the
facts are literal domain events (as here) or a signed delta record like
this one. A rewrite-in-place approach might look correct for the common
case and only reveal its unsafe edges under a rarer combination the author
didn't enumerate; the append-only version doesn't have those edges to find,
because it never needs to reconstruct what to delete.
