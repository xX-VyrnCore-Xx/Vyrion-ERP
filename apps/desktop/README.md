# Vyrion ERP desktop

Tauri 2 shell (Rust) with a React + TypeScript front end. The app is offline-first: data lives in
an encrypted SQLite database on the computer, and the server link is optional.

```bash
pnpm install
pnpm dev          # front end in the browser (in-memory data, for development only)
pnpm tauri dev    # the real app window with the encrypted local database
pnpm test         # unit tests
pnpm build        # type check and production build
```

More: `docs/MODULES.md` (what each module does), `docs/SYNC_ENGINE.md` (server link) and
`docs/RELEASING.md` (installers and releases).
