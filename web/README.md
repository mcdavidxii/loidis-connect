# Loidis Connect: rota engine test UI

First version of the screens for the rota engine test (see `../docs/MVP.md`). Screens:
Upload, Settings, Run, Review, Export. It is a Next.js app (App Router, TypeScript,
Tailwind CSS, lucide-react). There is no database: nothing is stored on the server.

By default it runs against a **built-in mock** of the engine API with made-up data
(2 teams, 8 carers, 15 clients, about 116 visits). The contract is in
`../docs/ENGINE_API.md`.

## Run it

```bash
cd web
npm install
npm run dev        # http://localhost:3000
```

Open the app, press **Use the made-up sample files** on the Upload screen, then work
through Settings, Run and Review. The page shows "Demo mode: made-up data" while the mock
is in use.

```bash
npm run build      # production build
npm run start      # serve the production build
npm run lint
```

## The `ENGINE_API_URL` switch

The browser only calls `/api/engine/...` on this app (`app/api/engine/[...path]/route.ts`).

- `ENGINE_API_URL` **unset**: the route answers from the mock in `lib/mock/`.
- `ENGINE_API_URL` **set** (for example `http://localhost:8000`): the route forwards each
  request unchanged to that service. Put it in `web/.env.local` (git-ignored) or the
  environment. See `.env.example`.

The engine URL, and later any token, stay on the server and never reach the page.

## Rules this app follows

- No real data: the mock's carers and clients are obviously fake. Do not put real files
  in this folder.
- Nothing third-party is loaded by the page: no CDN scripts, web fonts, analytics or map
  tiles. It uses the system font stack; npm packages are bundled.
- Error messages show counts, column names and IDs only, never names.
- Results are deleted when the page closes (`DELETE /runs/{id}` on `pagehide`).

## Layout

- `app/` page and the API route (mock or proxy)
- `components/` screens (`UploadStep`, `SettingsStep`, `RunStep`, `ReviewStep`, `Roster`, `ExportStep`)
- `lib/types.ts` contract types, `lib/settings.ts` settings defaults, validation and warnings, `lib/api.ts` browser client
- `lib/mock/` the mock engine and made-up agency

## Stubbed or not done yet

- The mock is a simple greedy allocator; its numbers mean nothing.
- "Lock to carer" sends a lock with the next run, which the mock honours; the real
  service must implement `locks`.
- No login (a "Coordinator" label only), mobile layout, printable summary or
  daily sickness cover.
- The Upload screen checks the real 27-column CareLineLive optimised bookings CSV
  (`lib/csv.ts`; dd/mm/yyyy dates, quoted comma-separated carer names) and the mock's
  sample file uses the same format. Messages never contain cell values.
- `agency.team_regions` is shown read-only. `new_time_needed` and `within_tolerance` are
  read when the service sends them; otherwise the UI works them out from `new_start` and
  the arrival tolerance setting.

To try it against the real service in fake mode, see `../service/README.md`
(`ENGINE_FAKE_API=1`), then `ENGINE_API_URL=http://127.0.0.1:8000 npm run dev`.
