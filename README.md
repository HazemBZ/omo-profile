# omo-profile

Switch your whole agent/model setup with one command.

Oh My OpenAgent controls which model every agent and category uses, and it
lives in one JSONC file you'd otherwise edit by hand. `omo-profile` snapshots
just the `agents` and `categories` sections of that file into named profiles,
so swapping setups is one command instead of a find-and-replace session.

Runs on Node 18+. Windows, macOS, Linux.

## Install

```bash
pnpm add --global omo-profile
# or
npm install --global omo-profile
```

The package exposes the `omo-profile` command through its `bin` entry.

```bash
omo-profile help
```

### Windows notes

PowerShell may refuse to run the CLI shim if script execution is restricted.
Allow local scripts for the current user account once:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

If a freshly installed command is not found in a new terminal, fully close and
reopen the terminal. Windows PowerShell and Windows Terminal cache the
environment from process start. Alternatively, run `pnpm setup` once so the
pnpm global bin directory is added to `PATH`.

### Uninstall

```bash
pnpm remove --global omo-profile
# or
npm uninstall --global omo-profile
```

Uninstalling the CLI does not remove saved profiles or the active OpenAgent
configuration.

## Quick start

Save your current setup, then flip between profiles:

```bash
omo-profile list               # what's saved
omo-profile current            # which saved profile matches your config
omo-profile save my-setup      # snapshot current agents + categories
omo-profile diff gpt-mix       # see exactly what switching would change
omo-profile switch gpt-mix     # apply it
```

`switch` backs up first, then rewrites only `agents` and `categories`.
Everything else in your JSONC, including comments and trailing commas, stays
byte-for-byte intact. Use `switch <id> --dry-run` to preview without writing.
Restart OpenCode after a real switch.

`diff` and `switch --dry-run` compare canonically: object key order is ignored
and array order is significant. `current` uses sparse matching: only entries
declared by a profile are checked, but every declared entry must match exactly,
including unknown fields.

## Safety

- Every real `switch` and `restore` creates a timestamped backup first.
- Profile switching touches only `agents` and `categories`.
- `--dry-run` never locks or writes.
- The CLI rejects symlinked configuration, profile, and backup paths for writes.

## Bundled starter profiles

The package ships `deepseek-free`, `deepseek-pro`, `gpt-luna`, `gpt-mix`, and
`gpt-terra`. On the first `list`, `current`, `diff`, or non-dry-run `switch`,
they are copied into the saved profiles directory. Existing profiles with the
same ID are never overwritten, so seeded profiles can be edited or deleted like
any other profile.

## Command reference

| Command | Key flags | What it does |
| --- | --- | --- |
| `list` | `--json` | List saved profiles |
| `current` | | Show saved profiles matching the active config |
| `diff <id>` | `--json` | Show changes a switch would make |
| `save <id>` | `--force`, `--json` | Snapshot the active config as a profile |
| `switch <id>` | `--dry-run`, `--json` | Apply a profile after backing up |
| `clone <src> <dst>` | `--json` | Copy a profile |
| `rename <old> <new>` | `--json` | Rename a profile |
| `delete <id>` | `--yes`, `--json` | Delete a profile |
| `backups` | `--json` | List config backups |
| `backups prune` | `--keep <n>`, `--json` | Keep only the newest `n` backups |
| `restore <backup-id>` | `--json` | Restore a config backup |
| `doctor` | `--json`, `--offline` | Diagnose setup health without changing it |

Global `--config <path>` (or `--config=<path>`) points to a specific config
file and may appear anywhere on the command line. Profile IDs may contain
letters, numbers, underscores, hyphens, and dots.

## Doctor

`doctor` is a read-only diagnostic. It never seeds profiles, creates backups,
removes stale locks, or changes configuration. It checks configuration discovery
and validity, saved profiles, active-profile matching, duplicates, model
references, filesystem permissions, backups, temporary files, and lock state.

```bash
omo-profile doctor
omo-profile doctor --offline
omo-profile doctor --json
omo-profile --config ./custom.jsonc doctor --json --offline
```

- `--offline` skips OpenCode model-availability discovery while still checking
  model references and every local diagnostic.
- `--json` emits the raw report object with `healthy`, `summary`, and `checks`.
- A healthy report exits `0`; a report containing failed checks exits `1`.
  Warnings alone do not make a report unhealthy.

Unlike mutating and lookup commands, `doctor --json` intentionally returns its
diagnostic report for both healthy and unhealthy outcomes. This is the
read-only diagnostic exception to the general JSON-output rule below: an
unhealthy report remains available on stdout and exits `1` so automation can
both inspect findings and detect failure.

## Lifecycle details

```bash
omo-profile save <profile-id> [--force] [--json]
omo-profile clone <source-id> <destination-id> [--json]
omo-profile rename <old-id> <new-id> [--json]
omo-profile delete <profile-id> [--yes] [--json]
omo-profile backups [--json]
omo-profile backups prune --keep <positive-integer> [--json]
omo-profile restore <backup-id> [--json]
```

### Saving and forcing

Saving over an existing profile fails with exit `4`; pass `--force` to replace
it. A forced save copies the previous bytes into a
`.profile-backup-<id>-<timestamp>-<attempt>.json` file in the profiles
directory before replacement.

### Backup IDs

Every real switch and restore creates
`<config>.backup-<13-digit-UTC-ms>-<base64url-suffix>` beside the config. The
backup ID is the `<ms>-<suffix>` portion. `backups` lists IDs newest-first, and
`restore <backup-id>` accepts exactly that form.

Backups are never pruned automatically. `backups prune --keep <n>` deletes all
but the newest `n`; `--keep` must be a positive integer.

### Confirmation

`delete` refuses to run non-interactively unless `--yes` is given. In an
interactive terminal it prompts `Delete profile "<id>"? [y/N]`; only `y` or
`yes` deletes. Any other response, including EOF, leaves the profile untouched
and exits `0`. Deleting a profile never modifies the active configuration.

### JSON output contract

Successful commands accepting `--json` emit exactly one machine-readable
`{ "ok": true, ... }` object on stdout. Diagnostics and errors go to stderr,
and failed commands normally write nothing to stdout. `delete --json` also
requires `--yes`.

`doctor` is the explicit exception: because its result is a diagnostic report,
`doctor --json` writes raw report JSON on healthy and unhealthy outcomes, with
exit `0` and `1` respectively.

### Locking and symlinks

Profile mutations serialize on `.omo-profile.lock` in the profiles directory;
configuration mutations serialize on the same filename in the configuration
directory. Dry-run and doctor operations never lock or write.

The CLI never follows symlinks for writes. A symlinked configuration file,
profile path, profile directory, or backup path is rejected before mutation
with exit `5`.

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success or healthy doctor report |
| 1 | Unexpected failure or unhealthy doctor report |
| 2 | Argument or confirmation error |
| 3 | Profile, backup, or configuration missing |
| 4 | Profile or destination already exists |
| 5 | Invalid, malformed, symlinked, or unsafe path |
| 6 | Mutation lock unavailable |

## File locations

The active configuration is discovered in this order:

| Priority | Filename |
| --- | --- |
| 1 | `oh-my-openagent.jsonc` |
| 2 | `oh-my-openagent.json` |
| 3 | `oh-my-opencode.jsonc` |
| 4 | `oh-my-opencode.json` |

| Purpose | Default location |
| --- | --- |
| Active configuration | `~/.config/opencode/oh-my-openagent.jsonc` |
| Saved profiles | `~/.config/opencode/omo-profiles/` |
| Profile format | `<profile-id>.json` |

The first existing file wins. On Windows, the primary configuration directory
is `%APPDATA%\opencode`, with `~/.config/opencode` as fallback. macOS and Linux
use `~/.config/opencode`.

## Environment overrides

```bash
OMO_CONFIG_PATH=/path/to/oh-my-openagent.json \
OMO_PROFILES_DIR=/path/to/profiles \
omo-profile list
```

Supported variables:

- `OMO_CONFIG_PATH` overrides the discovered active configuration.
- `OMO_CONFIG` aliases `--config` and takes precedence over `OMO_CONFIG_PATH`.
- `OMO_CONFIG_DIR` overrides the directory scanned for config filenames.
- `OMO_PROFILES_DIR` overrides the saved profiles directory.
- `OMO_BUNDLED_PROFILES_DIR` overrides the bundled starter profiles directory.

Active configuration precedence:

1. `--config <path>`
2. `OMO_CONFIG`
3. `OMO_CONFIG_PATH`
4. Filename auto-discovery in the config directory

PowerShell examples can preserve paths containing spaces by assigning literals:

```powershell
$env:OMO_CONFIG_PATH = Join-Path $HOME 'OpenCode Config/oh-my-openagent.json'
$env:OMO_PROFILES_DIR = Join-Path $HOME 'OpenCode Profiles'
omo-profile list
Remove-Item Env:OMO_CONFIG_PATH, Env:OMO_PROFILES_DIR -ErrorAction SilentlyContinue
```

## Development

```bash
pnpm test
pnpm run test:int
pnpm run test:all
pnpm run verify:pack
pnpm run smoke:packed
node agent-profile.mjs <command>
```

## Release

Releases use a protected tag named `v<package-version>`, such as `v2.1.0`,
after all required checks pass. Verify package-name ownership or availability
before tagging.

```bash
pnpm test
pnpm run test:all
pnpm run verify:pack
pnpm run smoke:packed
git tag v2.1.0
git push origin v2.1.0
```

Repository administrators must protect `v*` tags before using this release
path. Configure npm trusted publishing for this repository and the
`npm-release` environment so the workflow can use OIDC. If trusted publishing
is unavailable, administrators may provide `NPM_TOKEN` as a masked repository
secret; the workflow still publishes with provenance. Do not publish from a
branch or an unprotected tag.

## License

MIT. See [LICENSE](LICENSE).
