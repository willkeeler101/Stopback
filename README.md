# StopBack — Door-to-Door Sales Tracker

A mobile-first web app for door-to-door (D2D) sales reps to track their day in
the field: log contacts, save "stop backs" (prospects whose number you got),
record demeanor and notes, and watch your funnel and conversion rates update
live. Built to be used on a phone while canvassing and reviewed on a laptop.

> Working title — easily renamed in one line (`APP_NAME` in `app.js`).

## Features

- **Four key metrics** — Contacts, Stop Backs, Missed Closings, Sales
- **Fast field logging** — one-tap contact tally + a quick stop-back form
- **Lead records** — name, phone, address, demeanor, and notes per prospect
- **One-tap follow-up** — Call and Text buttons open your phone's dialer/SMS
- **Live analytics** — funnel + stop-back rate, close rate, and overall conversion
- **Works offline** — data is saved on your device (`localStorage`)
- **Backup** — export/import your data as a JSON file so you never lose leads

## Tech stack

- HTML, CSS (custom dark theme), and vanilla JavaScript — no frameworks, no build step
- `localStorage` for offline persistence

## Run it

1. Download/clone the repo.
2. Open `index.html` in a browser (or host it free on GitHub Pages and open on your phone).

## Roadmap

See [ROADMAP.md](ROADMAP.md). Built in phases: core tracker → leads polish →
product catalog → printable brochure generator → installable PWA + analytics.

## Why I built it

I do door-to-door sales and needed one place to track every contact, stop back,
and sale — plus the product info I use to make printed brochures for customers.
I built it with Claude Code, learning front-end fundamentals along the way.
