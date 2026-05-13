# Releasing openclaw-hawkins

Releases are **tag-driven**. Push a `vX.Y.Z` tag on `main` and the
[`Release` workflow](.github/workflows/release.yml) publishes the **same
build artifact** to both npm and ClawHub. The tag is the source of truth — if
`package.json#version` and the tag disagree, the workflow refuses to publish.

## One-time setup (repo owner / maintainer)

Two GitHub Actions secrets are required:

| Secret name      | Where to get it                                                                                                | Scope                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `NPM_TOKEN`      | npmjs.com → _Access Tokens_ → **Automation** token (read & publish). Use a CI-scoped token, not your personal. | `publish` on `openclaw-hawkins`        |
| `CLAWHUB_TOKEN`  | ClawHub dashboard → _Account_ → API tokens → **Publish** scope.                                                 | `package publish` for your handle      |

Add them via the repo's _Settings → Secrets and variables → Actions → New repository secret_.

The workflow also relies on **npm provenance**, which uses OIDC — no extra
secret needed; GitHub Actions issues a short-lived token automatically when
`permissions: id-token: write` is set on the job (it is).

## Cutting a release

1. **Bump the version** in `package.json` (e.g. `1.0.0` → `1.0.1` or
   `1.0.0` → `1.1.0` per semver). Commit on a release branch or main:

   ```bash
   git checkout main && git pull
   npm version patch        # 1.0.0 → 1.0.1  (also creates a v1.0.1 tag locally)
   # or:  npm version minor / npm version major
   # or:  edit package.json by hand if you prefer:
   #        sed -i 's/"version": "1.0.0"/"version": "1.0.1"/' package.json
   #        git commit -am "chore: bump version to 1.0.1"
   #        git tag v1.0.1
   ```

   `npm version` is the safer path — it bumps `package.json`, commits, and
   creates the matching tag in one transaction.

2. **Push the commit and tag together** so the tag lands with its content:

   ```bash
   git push origin main --follow-tags
   # or, explicit:
   git push origin main
   git push origin v1.0.1
   ```

3. **Watch the workflow.** GitHub Actions → _Release_ run. It will:
   1. Verify the tag matches `package.json#version`.
   2. Install deps with a frozen lockfile, typecheck, build, run coverage.
   3. `npm publish --provenance --access public` — publishes to
      `https://registry.npmjs.org/openclaw-hawkins/<version>`.
   4. `clawhub package publish` — publishes the same source tree to ClawHub
      with the version, source repo, source ref, and source commit recorded
      so the release is traceable back to this exact commit.

4. **Verify.** A few minutes after the workflow succeeds:

   ```bash
   # npm
   npm view openclaw-hawkins version
   npm view openclaw-hawkins.openclaw   # confirms the openclaw.extensions block landed

   # ClawHub
   openclaw plugins search openclaw-hawkins
   ```

## Manual one-off (without a tag — emergency only)

The workflow also supports `workflow_dispatch` with a `tag` input, but the
tag still has to exist on `main` first. Manual dispatch is only useful for
retrying a failed publish — never use it to publish a version that isn't
already tagged in git, or the npm artifact won't match the source.

## Rollback / yank

- **npm:** `npm deprecate openclaw-hawkins@<version> "<reason>"`. Yanking
  with `npm unpublish` is allowed only within 72 hours and is strongly
  discouraged — prefer deprecate + publish a fix version.
- **ClawHub:** `clawhub hide openclaw-hawkins` (owner). `clawhub delete`
  for a hard removal. Re-publish a new version after fixing the issue.

## What gets shipped

`package.json#files` controls the npm tarball contents. As of this writing
the tarball contains:

```
dist/                            # compiled TypeScript
vines/{spec.md,schema.sql}       # VINES contract + DDL
vecna/{spec.md,schema.sql}       # VECNA contract + DDL
scripts/{bootstrap-vines-db.sh,bootstrap-vecna-db.sh}
agents/                          # 6 specialist agent AGENTS.md templates
orchestrator/HAWKINS_PROTOCOL.md # the doc that teaches the Nexus the plugin tools
openclaw.plugin.json             # plugin manifest
README.md, INSTALL.md, LICENSE
```

Verify before tagging with `npm pack --dry-run`.
