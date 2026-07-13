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
   time and day-remaining time always visible at the top.
8. Data should be redundancy-free and compact (timestamps). Everything is
   derived from the event data resp. calculated on-the-fly.
9. If the start date is (relative to local calender) a day before or earlier, 
   the user seems to forgot the stop. In this case we have to show all days (one day per row) and the user can enter the working hours per day he did work since the last start.
