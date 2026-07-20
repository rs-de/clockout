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
