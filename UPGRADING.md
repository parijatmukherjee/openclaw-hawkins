# Upgrading openclaw-hawkins

This guide covers upgrading across the version boundaries that need operator
action. For the full list of changes per release, see [`CHANGELOG.md`](CHANGELOG.md).

---

## 1.x → 2.x (breaking)

`2.0.0` is a security-hardening release with **two breaking changes**. If you
are on `1.0.x` or `1.1.0`, fix your configuration **before** restarting the
gateway on 2.x — otherwise the plugin will refuse to start with the old config.

### Breaking change 1 — `MARIADB_SSL=insecure` is removed

The TLS mode that skipped server-certificate verification is gone (it allowed
man-in-the-middle attacks against the database connection). Every TLS mode now
verifies the certificate, and the plugin **rejects** the old value:

```
MARIADB_SSL must be one of disabled|preferred|required
```

**Migrate:**

- DB has a CA-trusted certificate → set `MARIADB_SSL=preferred` (or `required`).
- DB presents a **self-signed** certificate → either install a CA-trusted cert,
  **or** reach the DB over an SSH tunnel and use `MARIADB_SSL=disabled` on the
  loopback hop (the tunnel already encrypts and authenticates the link). See the
  README's "Behind a firewall / SSH-only DB?" section.

```bash
openclaw config set plugins.entries.openclaw-hawkins.config.mariadb.ssl preferred
```

### Breaking change 2 — a password in `MARIADB_URL` is rejected

`MARIADB_URL` is stored in plaintext config, so a password embedded in it would
leak. The loader now rejects any password in the URL — including an empty one
(`user:@host`):

```
MARIADB_URL must not contain a password (it would be stored in plaintext config)
```

**Migrate:** strip the password (and the `:` delimiter) from the URL, keep the
username if you like, and supply the password from the gateway environment:

```bash
# before:  mariadb://hawkins:s3cret@db.example.com:3306/hawkins
# after:
openclaw config set plugins.entries.openclaw-hawkins.config.mariadb.url \
  "mariadb://hawkins@db.example.com:3306/hawkins"
# password comes from the gateway env (a 0600 EnvironmentFile), never config:
#   MARIADB_PASSWORD=...    (see the README "Secrets policy" section)
```

### Other 2.x changes worth knowing (non-breaking)

- **VECNA is operator-gated.** Agents no longer auto-recall from or auto-publish
  to the Hive. Recalled fragments are treated as untrusted reference material,
  and `vecna_connect`/`vecna_evolve` require explicit operator approval and must
  not carry secrets. If you relied on the old auto-recall/auto-push behavior,
  re-enable VECNA per session and approve writes deliberately.
- **The plugin is a persistent runtime plugin** (activates on gateway startup),
  not a one-shot installer — the manifest description now reflects that.
- **`openclaw hawkins setup` backs up before it overwrites.** It backs up an
  existing `AGENTS.md` before overlaying it and retires `BOOTSTRAP.md` to a
  timestamped `.bak` instead of deleting it, so re-running setup is safe.

### Upgrade steps

1. Update the plugin:
   ```bash
   openclaw plugins update openclaw-hawkins \
     || openclaw plugins install clawhub:openclaw-hawkins \
     || openclaw plugins install npm:openclaw-hawkins
   ```
2. **Fix your config** for the two breaking changes above (TLS mode + URL
   password) — do this before the restart.
3. Restart the gateway:
   ```bash
   openclaw gateway restart
   ```
4. (Optional) Re-run setup to refresh the agent overlays — it now backs up
   first:
   ```bash
   openclaw hawkins setup
   ```
5. Verify:
   ```bash
   openclaw plugins inspect openclaw-hawkins --runtime --json \
     | jq '.plugin | {status, toolNames}'
   ```

---

## 1.0.x → 1.1.0

`1.1.0` enforced **auth-by-default for VECNA** (ASI06). If you run the Hive
(`vecna serve`), it now **refuses to start unauthenticated**:

- Recommended: set a bearer token —
  `export VECNA_AUTH_TOKEN=$(openssl rand -hex 32)`.
- Or explicitly opt out (not recommended) — `export VECNA_ALLOW_INSECURE=1`.

This carries forward into 2.x unchanged.
