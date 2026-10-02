# The operator console

The admin console (`app/(admin)`) is how staff run a programme day without touching `curl`: vetting
collectors, approving payouts, running the treasury vote, reviewing evidence and verifying the
ledger. It is deliberately plain: it composes the shared UI primitives in the existing token
styling, and a designer can restyle it later without touching its logic.

## Who sees what

| Role | Screens |
|---|---|
| `admin` | Overview, Collectors, Payouts, Collections, Treasury, Anomalies, Reconciliation, Ledger, Sessions, Rotations, Staff |
| `hub_lead` | Overview, Collectors, Payouts, Collections |

The nav filters by scope (`components/admin/AdminNav.tsx`), admin-only pages redirect a hub lead to the
overview (`lib/auth/page-guard.ts`), and **every API call is still checked by the server**. Hiding a
button is a convenience, never the control.

## How a screen is built

- A thin server page under `app/(admin)/<name>/page.tsx` renders one client component from
  `components/console/`. The layout provides who is signed in (`useConsoleUser()`, with `can(scope)`).
- Client components read and write through `/api/v1` using `lib/console/api.ts`. It never throws: a call
  resolves to `{ ok, data }` or `{ ok: false, code, status }`. The UI switches on the stable error `code`
  and shows a translated message (`Console.errors.<code>` in `messages/*.json`). It never shows the
  English `message`.
- `components/console/kit.tsx` has the shared pieces: `DataState` (loading, error, empty, content in one
  place), `ActionButton` (runs an API action, disables itself, asks first when `confirm` is set, shows the
  failure beside the button), `DomainPill` (a status chip that is icon, colour and text), tables, fields.
- `components/console/hooks.ts` has `useApi` (GET and keep the last good data while reloading) and
  `usePaged` (cursor pagination with Load more).
- Every user-facing string is a `messages/{en,sw,sheng}.json` key under `Console.*`. `sw` and `sheng`
  carry English placeholders until translated.

## Adding a screen

1. Add the page and a client component. Use `DataState` so loading, error and empty states exist.
2. Add the nav entry with the scope that gates it.
3. Add the strings to all three message files.
4. If the screen needs data the API does not return, change the API first and update `docs/BACKEND.md`
   in the same change.
5. Add it to the accessibility pass (`e2e/a11y.spec.ts`).

## Tests

`e2e/field-story.spec.ts` runs the whole programme story in real browsers (session, enrolment,
authorization, offline weigh, sync, approval, payout, verification picture, ledger). It drives the
payout worker step through the same handler the worker process registers, because the harness does not
start a second process. `e2e/treasury-vote.spec.ts` runs the funding vote with three admins.
`e2e/a11y.spec.ts` runs axe over the public pages, every console page and the supervisor pages.
