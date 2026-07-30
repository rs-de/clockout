# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/); versioning is
[SemVer](https://semver.org/).

## [0.4.0] - 2026-07-30

### Added

- Greeting landing screen shown instead of the tracking view whenever
  there's nothing to actually show yet: "Good morning" / "Welcome back"
  with a "Start work" button before anything's tracked, or the existing
  "Done for today" headline with a "Back" button once the day is booked
  out.
- A "booked out for the day" example scenario, alongside a
  `next-morning` example demonstrating the new greeting screen.

### Fixed

- Booking late at night no longer projects a bogus middle-of-the-night
  quitting time; a "Done for today — see you tomorrow!" headline shows
  instead.
- "Start work" on the greeting landing now actually starts the block,
  instead of only dismissing the landing screen.

## [0.3.0] - 2026-07-29

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

[0.4.0]: https://github.com/rs-de/clockout/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/rs-de/clockout/compare/v0.2.5...v0.3.0
