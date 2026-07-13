# Engineering Paradigms Realized in clockout

Key properties of a well-built web application that this project embodies.

---

## 1. Validate on submit, not by disabling the control

A submit button is never disabled because of live client-side validation
while the user is still typing — a disabled control gives no explanation
and native form submission (Enter key, assistive tech) can't reach it
either. Constraints natively expressible in HTML (`required`, `min`/`max`)
are left to the browser's own validation; anything else (like a
password-confirmation mismatch) is checked inside the submit handler,
which blocks the submission and surfaces the same error a live hint
would, without ever gating the control itself.
