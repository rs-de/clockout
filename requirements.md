# Requirements

Lean app for time tracking, so you can see how much work is still left
(regarding day and week).

1. Data is identified by a globally unique id (nanoid).
2. Before data goes to the server it must be encrypted. The key is a password.
3. We can assume a password manager will be used.
4. In browser storage the data is decrypted; the password is only needed
   again if browser storage has been cleared.
5. At the start, weekly work time (35h) and max. daily work time (9h 55m)
   are configured (pre-filled default in parentheses).
6. Config and password (with repetition) on the start page; continue with
   button "Save and go...".
7. Tracking: a "start" button (green), a "stop" button (red); week-remaining
   time and day-remaining time always visible at the top. Today's first
   start time is always shown too — fixed for the day, unaffected by any
   later stop/restart (e.g. a lunch break).
8. Data should be redundancy-free and compact (timestamps). Everything is
   derived from the event data resp. calculated on-the-fly.
9. The always-visible weekly breakdown (Monday..Sunday) shows each day's
   booked time as plain text — except any past day this week with nothing
   booked yet (an unfinished start, the days after a last stop, or simply
   never touched, e.g. before the first-ever tracked event), which instead
   shows input fields for the hours worked plus a "did not work" checkbox to
   explicitly mark it as a day with no hours.
10. A start/stop pair shorter than 1 minute is discarded (not tracked, as
    if the start never happened) — most likely an accidental tap.
11. An "About this app" page links to a few named examples (e.g. "forgot to
    stop", "lunch break"). Opening one seeds throwaway, in-memory-only demo
    data — nothing is saved or synced — so the real app can be tried without
    setup. Each example simulates its own fixed weekday/time so the shown
    numbers stay consistent no matter which real day it's opened on.
12. Once the week's target is already met, day-remaining shows 0 rather than
    a full/positive value that implies budget is still available — unless
    today's own hours already exceed the daily max on their own, in which
    case that real, same-day overage still shows.
