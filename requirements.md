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
9. If the last event (start or stop) is not from today, the user likely
   missed tracking one or more days. Show one row per missing day — the day
   of an unfinished start (inclusive), or the day after the last stop,
   through yesterday — so the user can enter the hours worked that day.
10. A start/stop pair shorter than 1 minute is discarded (not tracked, as
    if the start never happened) — most likely an accidental tap.
