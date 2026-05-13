# Contributing to openclaw-hawkins

Thanks for considering a contribution. This repo ships a drop-in orchestration
pattern for OpenClaw plus the **VINES** Node
library that implements the [spec](vines/spec.md). The goal of this guide is to
make first-time contributions painless.

## Quick start (5 minutes)

```bash
git clone https://github.com/parijatmukherjee/openclaw-hawkins.git
cd openclaw-hawkins
make install        # npm ci / npm install
make check          # lint + format-check + typecheck + tests
```

You should see all green. If anything fails on a fresh checkout, that's a
bug — please open an issue.

## What we accept

We love PRs that:

- **Fix a bug** with a regression test that exercises the fix.
- **Add a feature** with documentation in the README / spec and tests
  covering happy + failure paths.
- **Improve docs** (especially `vines/spec.md`, `INSTALL.md`, and the agent
  personas under `agents/`).
- **Sharpen quality** — better types, tighter error messages, less code,
  more invariants enforced.

We are cautious about PRs that:

- Break the public VINES contract (`vines/spec.md`) without a migration path.
- Add new top-level dependencies. Each dep is a maintenance commitment —
  please justify it in the PR description.
- Introduce LLM-specific behaviour at the library layer. The library should
  remain transport-agnostic (see [Architecture](#architecture) below).

## Development workflow

```bash
# Common dev loop
make test               # run the hermetic unit suite (no network, no DB)
make coverage           # run with coverage thresholds enforced
make lint               # eslint
make format             # prettier + eslint --fix
make check              # everything CI runs

# Smoke tests against real services (auto-skipped when env vars missing)
export MARIADB_URL=mariadb://h:3306/orchestra
export MARIADB_USER=orchestra
export MARIADB_PASSWORD=…
export LINEAR_API_KEY=lin_api_…
make smoke              # `vitest run --config vitest.smoke.config.ts`

# Schema work
make bootstrap-db       # apply vines/schema.sql via shell client
make init-db            # apply via the Node CLI (alternative)
```

### Branch + PR

1. Branch from `main`: `git checkout -b feat/<short-name>` or `fix/<short-name>`.
2. Make atomic commits. Keep each commit independently buildable / testable.
3. Run `make check` locally before pushing.
4. Open a PR against `main`. CI will run on push.

### Commit message style

We follow loose [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(persistence): add bulk insert helper for ledger seeding
fix(recovery): tolerate non-Error rejections from Linear list_children
docs(spec): clarify the >30s triage rule with worked examples
chore(deps): bump vitest 2.1.0 → 2.1.4
```

Type prefixes we use: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`,
`build`, `ci`, `perf`.

## Architecture

The codebase is layered intentionally so each layer can be reasoned about in
isolation.

```
┌──────────────────────────────────────────────────────────┐
│  Orchestrator agent (LLM-driven, lives in OpenClaw)      │
│  Reads operator request, calls into the VINES library      │
└──────────────────────────┬───────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────┐
│  src/orchestrator.ts   ← protocol engine (spec §3)       │
│  src/recovery.ts       ← spec §4.2 cross-reference       │
└────────┬──────────────────────────────────────┬──────────┘
         │                                      │
┌────────▼────────┐  ┌────────────────┐  ┌──────▼──────────┐
│ persistence.ts  │  │ linear-client  │  │  dispatcher.ts  │
│ MariaDB ledger  │  │  GraphQL only  │  │  openclaw CLI   │
└─────────────────┘  └────────────────┘  └─────────────────┘
```

The library layer never reaches into the LLM. It is mechanical: a planner
returns the sub-tasks, and the orchestrator drives them. The LLM lives one
level up, in the orchestrator agent's `AGENTS.md`.

## Testing

We use [vitest](https://vitest.dev) with v8 coverage. The CI thresholds
(authoritative in `vitest.config.ts`) are:

- statements ≥ **95 %**
- functions ≥ **95 %**
- branches ≥ **88 %**
- lines ≥ **95 %**

(branches is set slightly lower than the rest because the `vecna serve`
command — Express `app.listen` + signal-shutdown loop — is genuinely
hard to test hermetically. Everywhere else, branches sits comfortably
above 90 %.)

PRs that drop coverage below these gates will fail CI. Please add tests for
new code paths. Mock the network (`fetch`) and the database (the `mariadb`
driver) — tests must run hermetically in under a few seconds.

### Test fixtures

- `tests/conftest`-style helpers live alongside the suites they support; we
  don't have a global setup file.
- Use `vi.mock("mariadb", ...)` to swap the driver. See
  `tests/persistence.test.ts` for the pattern.
- Use `LinearClient({ fetchImpl: vi.fn() })` to inject a fake fetch.

## Documentation

- **`vines/spec.md`** is the contract. If you change library behaviour in a way
  that adopters could observe, update the spec first.
- **`README.md`** is the front door for new users. Keep it scannable.
- **`INSTALL.md`** is the long-form install guide. Code samples must work
  copy-paste.
- **JSDoc** on every exported symbol. The type signature is half the docs —
  add intent in the comment.

## Release process

1. Bump `version` in `package.json` and add a `CHANGELOG.md` entry.
2. Open a PR; merge after CI is green.
3. `git tag vX.Y.Z && git push --tags` — the publish workflow handles npm.

## Code of conduct

Be kind. Disagree on technical points. Don't make it personal. The full text
lives in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

By contributing, you agree your contributions are licensed under the MIT
License (the same license as the rest of the repo).

## Questions

Open an issue with the `question` label, or start a discussion. Issues and
PRs are the canonical record — please don't ping maintainers directly for
project work.
