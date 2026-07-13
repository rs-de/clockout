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
