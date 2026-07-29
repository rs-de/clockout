# Requirements

Lean app for time tracking, so you can see how much work is still left today,
and how your flextime depot is doing.

1. Data is identified by a globally unique id (nanoid).
2. Before data goes to the server it must be encrypted. The key is a password.
3. We can assume a password manager will be used.
4. In browser storage the data is decrypted; the password is only needed
   again if browser storage has been cleared.
5. At the start, daily minimum work time (7h) and daily max work time
   (9h 55m) are configured (pre-filled default in parentheses).
6. Config and password (with repetition) on the start page; continue with
   button "Save and go...".
7. Tracking: the current (unbooked) day is one or more work blocks, each
   with a start time and an end time. "Start"/"Stop" buttons fill the
   active block's start/end with the current time; both stay editable
   inputs so a wrong time can be corrected by hand. Completing a block
   (its end time gets filled) automatically appends a new, empty block
   below it, ready for the next start/stop.
8. Below the headline, an always-visible "Feierabend ist um {time}" shows
   when today's work is done: `now + dailyMin − depot − workedTime`,
   recomputed live (`workedTime` includes a currently running block's
   elapsed-so-far time). Shown as a plain clock time even if it's already
   in the past (i.e. the minimum is already covered).
9. Data should be redundancy-free and compact. The depot total is always
   derived from the latest "Buchung" (booking) event — see #11 — never
   stored-and-patched directly.
10. A start/stop pair shorter than 1 minute is discarded (not tracked, as
    if the start never happened) — most likely an accidental tap.
11. Booking closes out the current day: an editable "booking time" field,
    defaulting to `workedTime` topped up with available depot time (if
    any) — e.g. leaving early on a short day, funded by banked overtime —
    capped at the daily max, sits next to a "Buchen" (book) button.
    Pressing Enter while focused in the field also submits it. Submitting:
    - lets `bookingTime` exceed `workedTime` by at most the current depot,
      never inventing time from nowhere and never exceeding the daily max.
    - with `overlap = min(bookingTime, workedTime)`, adds
      `max(0, overlap - dailyMin) + (workedTime - overlap) -
      max(0, bookingTime - overlap)` to the depot: real worked time above
      the minimum still banks, worked time left unbooked (e.g. because
      it's over the max) still banks too, and any booked time beyond what
      was actually worked draws the depot down by exactly that much
      instead — a day worked at or above the minimum and booked at or
      under what was worked still only ever grows the depot, same as
      before; a short day topped up from the depot draws it down instead.
    - appends a "Buchung" event recording the new depot total (and the
      booking time), keeping a ledger of past bookings — how much (if
      any) depot a booking drew down is only ever derivable from that
      event's worked/booking time, never tracked separately.
    - discards the day's block events (start/stop pairs) — they're fully
      folded into the depot total and no longer needed.
12. An "About this app" page links to a few named examples illustrating
    block entry and depot booking. Opening one seeds throwaway,
    in-memory-only demo data — nothing is saved or synced.
