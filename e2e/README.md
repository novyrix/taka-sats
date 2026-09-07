# e2e/

Playwright end-to-end specs. Two suites are required (Code Style Guide §10):

| Suite                                                | File                    | Milestone        |
| ---------------------------------------------------- | ----------------------- | ---------------- |
| Offline weigh flow                                   | `offline-weigh.spec.ts` | **M3-11 — done** |
| Payout: verified event → confirmed Lightning payment | _(regtest)_             | M5-10            |

## Running

```sh
pnpm exec playwright install chromium   # once
DATABASE_URL=postgresql://…  AUTH_SECRET=…  pnpm e2e
```

`playwright.config.ts` builds the app (`build:turbo`) and starts it on port 3100
(`E2E_PORT` to override). `e2e/global-setup.ts` truncates and re-seeds a known
field supervisor + an active assigned session + a collector + a rate + an
exchange snapshot — so `DATABASE_URL` must point at a **throwaway** database.

CI runs this as the `e2e` job in `.github/workflows/ci.yml` (Postgres service +
`playwright install --with-deps chromium`).
