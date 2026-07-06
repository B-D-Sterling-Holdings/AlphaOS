---
name: verify
description: Build, launch, and drive AlphaOS end-to-end to verify UI changes at the browser surface.
---

# Verifying AlphaOS changes

## Build & serve
- Prod build: `npx next build` in the repo root. The always-on prod server is `next start -p 3457` (dev runs on 3000). After a rebuild, restart it **by PID** (`ss -ltnp | grep 3457` → `kill <pid>`, then `(nohup npx next start -p 3457 > .next-start.log 2>&1 &)`). Do NOT `pkill -f "next start -p 3457"` — the pattern matches your own shell command and kills it (exit 144).

## Drive it
- Playwright (Python) is installed via pipx: `/home/datta/.local/share/pipx/venvs/playwright/bin/python`, chromium in `~/.cache/ms-playwright`.
- Login: go to `/login`, fill `input[placeholder="Enter username"]` / `input[placeholder="Enter password"]` with **demo / demo**, click `button[type="submit"]`, then `wait_for_url` away from `/login` with a **60s timeout** — the demo login resets and reseeds the whole demo tenant, which takes many seconds. Demo data is throwaway by design: mutating it (stage moves, edits) is safe; the next demo login resets it.
- Company selector (Draft & Review, Research, Position Review): `get_by_placeholder('Search ticker...')` → click, `fill('<TICKER>')`, press Enter (commits the first filtered match). Dropdown options are plain `<button>`s, not `role=option`.
- Demo seed (as of 2026-07): draft stage has MCO (with generated data); research stage has FICO (no data) and MELI (with data). Stage-move buttons on each page ("Back to Draft & Review", "Move to Research", …) navigate to the target stage's page with `?ticker=`.
- Text-marker checks against `inner_text` see **rendered** case — many labels are CSS-uppercased (`PE RATIO`), so match case-insensitively or use screenshots.
- Expected noise: one `401 GET /api/auth/me` fires on the login page before authentication — pre-existing, not a finding.

## Gotchas
- Pages are fully client-rendered behind auth; curl of a page URL proves nothing beyond a 200. Screenshots are the evidence.
- Charts and quotes load async — give tabs ~3–5s after clicking before screenshotting.
