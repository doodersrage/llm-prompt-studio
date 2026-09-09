# Contributing to Prompt Studio

Thanks for taking a look at Prompt Studio. This is a fast-moving, mostly solo-maintained
project, so the bar for contributions is less about process and more about not breaking
the things CI already checks for you.

## Getting set up

Requires **Node.js 22+** (see `.nvmrc`).

```bash
npm install
cp .env.example .env.local
npm run dev
```

App runs at [http://localhost:47832](http://localhost:47832). Most tools work without a
live ComfyUI/LLM backend for UI-only changes, but queuing anything real needs
`COMFYUI_API_URL` pointed at a running ComfyUI instance — see
[docs/configuration.md](docs/configuration.md).

## Before you open a PR

Run what CI runs, in this order, so you catch problems before pushing:

```bash
npm run lint     # eslint + the client/server import boundary check
npm test         # node's built-in test runner over scripts/run-unit-tests.mjs
npm run build    # next build
npm run size      # size-limit budget check
```

If you touched anything in `e2e/`, or a flow those specs cover (gallery, Play/Roleplay,
auth/heal/workflow-editor), also run the relevant Playwright suite:

```bash
npm run test:e2e:gallery
npm run test:e2e:play
npm run test:e2e:ops
```

There's also `npm run test:e2e:a11y` — an axe-core smoke pass over Generate, Gallery,
Compose, Inpaint, and the Workflow editor, failing only on `critical`/`serious` impact
violations (`moderate`/`minor` findings are logged, not failed, to avoid drowning in
pre-existing noise). It runs on every push and PR too — the catch-all `npm run test:e2e`
step at the end of the CI `e2e` job scans all of `e2e/` with no path filter, so
`accessibility.spec.ts` rides along with it — but it's not a named, isolated step, so a
failure there surfaces mixed in with whatever else that last step covers. Run it locally
with the narrower command above against any page you touch that has non-standard
interaction (canvas, drag-and-drop, custom widgets) for a clearer signal before pushing.

A pre-commit hook (husky + lint-staged) already runs `eslint --fix` and `prettier --write`
on staged `.ts`/`.tsx` files, so most formatting nits are handled for you automatically.

### The client/server import boundary

`npm run lint` includes `scripts/check-client-server-imports.mjs`, which enforces that
server-only code (anything touching secrets, the filesystem, or `server-only`-marked
modules) never gets pulled into a client bundle. If lint fails here, it's almost always
an import that needs to move behind an API route rather than being called directly from
a client component.

## Commit style

History loosely follows [Conventional Commits](https://www.conventionalcommits.org/):
`feat(scope): ...`, `fix: ...`, `docs: ...`, `test: ...`. Scope is optional but helpful
when a change is localized (`compose`, `gallery`, `desktop`, etc.) — it's what
[CHANGELOG.md](CHANGELOG.md) generation keys off of. Squash-merge is fine; just keep the
final commit message descriptive, since it's what shows up in release notes.

## Where things live

- `src/app` — Next.js routes (one folder per tool page)
- `src/components`, `src/hooks`, `src/lib` — shared UI, hooks, and server/shared logic
- `docs/` — user-facing docs, published via [GitHub Pages](docs/README.md) (`npm run docs:serve` to preview locally)
- `e2e/` — Playwright specs
- `desktop/` — Tauri-based desktop packaging (macOS/Windows/Linux installers)
- `services/diffusers-engine/` — optional Python sidecar for the Diffusers inference engine

[docs/architecture.md](docs/architecture.md) has the fuller map if you're navigating for
the first time.

## Reporting issues and asking questions

GitHub Issues is the place for both right now — there's no issue template yet, so a
plain description works: what you expected, what happened, and (if it's
generation-related) which model/engine and whether ComfyUI or a cloud engine was in
play. Screenshots or a gallery/queue export help a lot for anything visual. If this
repo starts getting enough traffic that open-ended questions are crowding out actual
bug reports, GitHub Discussions is the natural next step — not turned on yet, just
worth knowing it's the plan rather than defaulting to Issues forever.

## License

Contributions are accepted under the project's [MIT license](./LICENSE).
