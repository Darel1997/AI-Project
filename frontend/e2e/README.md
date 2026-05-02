# E2E Tests

Playwright tests covering the critical user flows: landing, auth, marketing pages, error pages, and responsive behavior.

## One-time setup

```bash
cd frontend
npm install
npm run test:e2e:install  # downloads chromium + firefox (~300MB)
```

## Running tests

```bash
# Headless run
npm run test:e2e

# Interactive UI mode — best for debugging
npm run test:e2e:ui

# Single file
npx playwright test e2e/auth.spec.ts

# Single test
npx playwright test -g "register mode renders full signup form"

# Against a remote environment
PLAYWRIGHT_BASE_URL=https://staging.repoinsight.ai npm run test:e2e
```

## What's covered

| File | What it tests |
|---|---|
| `landing.spec.ts` | Homepage smoke tests: hero, CTAs, trust row, feature grid, skip link |
| `auth.spec.ts` | Login/register mode switching, password strength meter, show/hide, validation |
| `marketing.spec.ts` | Pricing tiers, billing toggle, comparison table, FAQ, changelog timeline |
| `not-found.spec.ts` | 404 page rendering, recovery links |
| `responsive.spec.ts` | Mobile vs desktop layout differences |

## What's *not* covered yet (requires a running backend + test user)

- Sign-up → dashboard → import repo → chat flow
- Analytics page with real repo data
- AI feature generation (docs, security scan, etc.)

For those, use a dedicated test environment with seeded data and update `playwright.config.ts` to point at it.

## Debugging tips

- **Trace on failure**: open `playwright-report/index.html` after a failed run — includes DOM snapshots at every step
- **Slow mo**: `npx playwright test --headed --slowmo 500`
- **Pause execution**: add `await page.pause()` — opens the Playwright inspector

## CI

The `.github/workflows/ci.yml` workflow runs `chromium` tests on every push + PR to `main`/`master`. Reports are uploaded as artifacts with 7-day retention.
