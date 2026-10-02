# e2e/

Playwright end-to-end specs:

| Suite              | File                    | What it proves                                                                                                     |
| ------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Offline weigh flow | `offline-weigh.spec.ts` | a collection is saved on the phone with no network                                                                 |
| The full story     | `field-story.spec.ts`   | session, enrolment, authorization, offline weigh, sync, approval, payout (demo rail), verification picture, ledger |
| Treasury vote      | `treasury-vote.spec.ts` | three admins: propose, two others approve, transfer recorded, arrival checked                                      |
| Accessibility      | `a11y.spec.ts`          | axe finds no serious or critical violation on the public, console and supervisor pages                             |

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
