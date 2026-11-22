# Quantum Referee Summary — Killarney Swim Club

A single-page web app that turns Swiss Timing **Quantum** heat result files (`.qaq`) into printable, grayscale referee summaries.

Open `index.html` in a browser (or host it on GitHub Pages), drag in a batch of `.qaq` files, and print or save to PDF. Everything runs in the browser: files are only read, never uploaded or changed.

## What it produces

- **Meet overview**: events, heats loaded, heats missing (when a start list is added), swims, flagged lanes, largest pad/backup difference.
- **Exceptions**: every event in its own boxed block. Events with problems list each flagged lane: the official **pad** time, both backup times, and each backup's difference from the pad (Δ = backup − pad). Clean events say so in one line.

A lane is flagged (▲, shaded) when a backup differs from the pad by at least the review threshold (default 0.30 s), when the two backups disagree by that much, or when a pad or backup time is missing.

## Optional files

- `quantum.sch` adds event names (e.g. "Girls 200 SC Meter Freestyle").
- `quantum.slx` adds swimmer names and clubs, and lists start-list lanes with no result.

## .qaq format (as read by this app)

```
019;2;4;P;100;QuantumAQ;6.1.21.0        event;heat;splits;round;?;source;version
6; ;46.06;97.68;149.32;198.83;198.82;198.84; ;0.99;
   place; code; splits… (last = pad); backup A; backup B; code; reaction
0;;;;;;;;;;;                              empty lane
```

Rows are lanes in pool order. Lane numbering defaults to "auto", which picks row 1 = lane 1 or row 1 = lane 0, whichever lines up with the start list.

Sample files are in `samples/`.
