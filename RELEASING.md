# Releasing openclaw-hawkins

Releases are **tag-driven**. Push a `vX.Y.Z` tag on `main` and the
[`Release` workflow](.github/workflows/release.yml) publishes the **same
build artifact** to both npm and ClawHub. The tag is the source of truth —
if `package.json#version` and the tag disagree, the workflow refuses to
publish.

## One-time setup (repo owner / maintainer)

### npm — Trusted Publishing (no long-lived token)

This package uses **npm Trusted Publishing** (OIDC). There is no
`NPM_TOKEN` secret to manage; npm validates a short-lived OIDC token
issued by GitHub Actions at publish time and accepts it because the
package is configured to trust this repo + workflow.

Configure it once on npmjs.com:

1. Sign in to <https://www.npmjs.com>.
2. **Pre-publication path (the package doesn't exist on npm yet):**
   - Top-right avatar → **Trusted Publishers** → **Add publisher**.
   - **Package name:** `openclaw-hawkins`
   - **Ecosystem:** `npm`
   - **Provider:** `GitHub Actions`
   - **Organization or user:** `parijatmukherjee`
   - **Repository:** `openclaw-hawkins`
   - **Workflow filename:** `release.yml`
   - **Environment:** _(leave blank)_
3. **Post-publication path (the package already exists):**
   - <https://www.npmjs.com/package/openclaw-hawkins/access> →
     **Trusted Publishers** → **Add publisher** → same fields as above.

The workflow already declares `permissions: id-token: write` so the OIDC
token is minted automatically.

The workflow also `npm install -g npm@latest` before publishing, because
Trusted Publishing requires npm CLI **≥ 11.5.1**.

### ClawHub — single secret

ClawHub still uses a token (no OIDC support yet for `clawhub package publish`).
Add a single repo secret:

1. ClawHub dashboard → **Account** → **API tokens** → **New token**.
2. Scope: `package publish` for handle `parijatmukherjee`.
3. Copy the token.
4. GitHub repo → **Settings → Secrets and variables → Actions →
   New repository secret**:
   - **Name:** `CLAWHUB_TOKEN`
   - **Value:** the token

The release workflow calls the reusable
`openclaw/clawhub/.github/workflows/package-publish.yml@v0.15.0` for the
ClawHub side — no `clawhub` CLI install in our own workflow, no custom
publish flags.

## Cutting a release

1. **Bump the version** in `package.json`:

   ```bash
   git checkout main && git pull
   npm version patch        # 1.0.0 → 1.0.1  (creates v1.0.1 tag locally)
   # or:  npm version minor / npm version major
   ```

   `npm version` is the safest path — it bumps `package.json`, commits,
   and creates the matching tag in one transaction.

2. **Push the commit and tag together:**

   ```bash
   git push origin main --follow-tags
   ```

3. **Watch the workflow.** GitHub Actions → _Release_ run. Two jobs:
   - `publish-npm` — verifies the tag matches `package.json#version`,
     runs typecheck + build + coverage, then `npm publish --provenance
     --access public`. Trusted Publishing validates the OIDC token
     against the publisher entry you configured above.
   - `publish-clawhub` — runs only if the npm job succeeds. Uses the
     ClawHub reusable workflow with `source =
     parijatmukherjee/openclaw-hawkins@<tag>`.

4. **Verify** after the run goes green:

   ```bash
   # npm
   npm view openclaw-hawkins version
   npm view openclaw-hawkins.openclaw    # plugin extension block

   # ClawHub
   openclaw plugins search openclaw-hawkins

   # End-to-end install
   openclaw plugins install clawhub:openclaw-hawkins
   openclaw plugins inspect openclaw-hawkins --runtime --json \
     | jq '.plugin | {status, toolNames}'
   ```

## Manual one-off (without a tag — emergency only)

The workflow supports `workflow_dispatch` with a `tag` input, but the tag
still has to exist on `main` first. Manual dispatch is only useful for
retrying a failed publish — never use it to publish a version that isn't
already tagged in git, or the npm artifact won't match the source.

## Rollback / yank

- **npm:** `npm deprecate openclaw-hawkins@<version> "<reason>"`. Yanking
  with `npm unpublish` is allowed only within 72 hours and is strongly
  discouraged — prefer deprecate + publish a fix version.
- **ClawHub:** `clawhub hide openclaw-hawkins` (owner). `clawhub delete`
  for a hard removal. Re-publish a new version after fixing the issue.

## What gets shipped

`package.json#files` controls the npm tarball contents. As of v1.0.0 the
tarball contains 112 files / ~98 KB packed:

```
dist/                            # compiled TypeScript
vines/{spec.md,schema.sql}       # VINES contract + DDL
vecna/{spec.md,schema.sql}       # VECNA contract + DDL
scripts/{bootstrap-vines-db.sh,bootstrap-vecna-db.sh}
agents/                          # 6 specialist AGENTS.md + IDENTITY.md.template
orchestrator/HAWKINS_PROTOCOL.md # teaches the Nexus the plugin tools
openclaw.plugin.json             # plugin manifest
README.md, INSTALL.md, LICENSE
```

Verify before tagging with `npm pack --dry-run`.
