# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/); versioning is
[SemVer](https://semver.org/).

## [Unreleased]

### Changed

- Replaced the weekly-target + event-log tracking model with a daily
  model: work is tracked in blocks (start/stop), overtime banks to a
  depot, and each day closes with an explicit booking against a daily
  minimum/max (see `requirements.md`).

### Added

- Live depot-after-booking preview in the booking form.
- Booking tops up a short day from the depot, capped at the daily max.
- Past-tense wording and a warning color once quitting time has passed.
- Block edits commit via an explicit Save button, not on every keystroke.

### Fixed

- Booking now banks only the overflow above the daily max, not all
  overtime above the minimum.
- The quitting-time estimate freezes once the minimum is covered and
  tracking stops, instead of continuing to drift with the clock.
- A document from before this rewrite (the v0.2.5 weekly-target/event-log
  model) no longer crashes the app on load — it starts fresh under the
  same id/password, with a one-time notice explaining the reset.

[Unreleased]: https://github.com/rs-de/clockout/compare/v0.2.5...HEAD
