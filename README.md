# omo-profile

`omo-profile` manages saved agent-model profiles for Oh My OpenAgent.
It snapshots the `agents` and `categories` sections of the Oh My OpenAgent
configuration, identifies matching saved profiles, previews canonical changes,
and applies saved profiles safely.

Requires Node.js 18 or newer.

### JSONC support

The active configuration is [JSONC](https://github.com/microsoft/node-jsonc-parser)
— JSON with `//` and `/* */` comments and trailing commas. `omo-profile`
parses JSONC and preserves comments, indentation, and newline style when it
writes; switching a profile changes only the `agents` and `categories`
sections and leaves everything else byte-for-byte intact.

Supports Windows, macOS, and Linux. The CLI uses the same OpenCode-compatible
configuration location on each supported desktop OS.

## Install

Install the package from npm with pnpm:

```bash
pnpm add --global omo-profile
```

Verify the installation:

```bash
omo-profile help
```

The package exposes the `omo-profile` command through its `bin` entry.

npm can also install the package if pnpm isn't available:

```bash
npm install --global omo-profile
```

### Windows notes

PowerShell may refuse to run the CLI shim if script execution is restricted.
Allow local scripts for the current user account once:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

If a freshly installed command is not found in a new terminal, the terminal
environment is stale: Windows PowerShell and Windows Terminal cache the
environment from process start. Fully close and reopen the terminal, or run
`pnpm setup` once so the pnpm global bin directory is added to PATH.

### Uninstall

Remove the globally installed CLI:

```bash
pnpm uninstall --global omo-profile
```

Uninstalling the CLI does not remove saved profiles or the active OpenAgent
configuration.

### Bundled starter profiles

The package ships starter profiles (`gpt56-mixed`, `gpt56-light`,
`gpt56-xlight`, `deepseek-v4-flash-free`) covering common model routings. On
the first `list`, `current`, `diff`, or non-dry-run `switch`, they are copied into the saved
profiles directory. Existing profiles of the same id are never overwritten, so
seeded profiles can be edited or deleted like any other profile.

## Usage

```bash
# List saved profiles
omo-profile list
omo-profile list --json

# Show every saved profile matching the active configuration
omo-profile current

# Show canonical changes needed to switch profiles
omo-profile diff <profile-id>
omo-profile diff <profile-id> --json

# Save the current configuration as a profile
omo-profile save <profile-id>

# Preview a profile switch
omo-profile switch <profile-id> --dry-run

# Apply a profile
omo-profile switch <profile-id>

# Point the CLI at a specific configuration file
omo-profile --config ./custom.jsonc switch <profile-id>
omo-profile --config=./custom.jsonc current
```

Applying a profile creates a timestamped backup of the active configuration,
replaces only `agents` and `categories`, and preserves other top-level keys.
Restart OpenCode after switching for changes to take effect.

`current` uses sparse matching: only agent and category entries declared by a
saved profile are compared, but every declared entry must match exactly,
including unknown fields. `diff` and `switch --dry-run` use the same canonical
comparison: object key order is ignored, array order remains significant, and
dry-run never modifies the configuration or profile directory.

Profile IDs may contain letters, numbers, underscores, hyphens, and dots.

## File locations

The active configuration is discovered in this order of preference:

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

The first existing file wins. If none exist, the CLI reports the checked
locations and exits. On Windows the primary configuration directory is
`%APPDATA%\opencode` with `~/.config/opencode` tried as a fallback; on macOS
and Linux it is `~/.config/opencode`.

The package ships these as bundled starter profiles; see the
[Bundled starter profiles](#bundled-starter-profiles) section.

## Environment overrides

Use literal `OMO_CONFIG_PATH` and `OMO_PROFILES_DIR` values to point the CLI at
alternate files or directories. These are explicit overrides, not alternate
default locations.

```bash
OMO_CONFIG_PATH=/path/to/oh-my-openagent.json \
OMO_PROFILES_DIR=/path/to/profiles \
omo-profile list
```

```bash
omo-profile --config ./custom.jsonc current
```

PowerShell examples preserve paths containing spaces by assigning each literal
path before invoking the command:

```powershell
$env:OMO_CONFIG_PATH = Join-Path $HOME 'OpenCode Config/oh-my-openagent.json'
$env:OMO_PROFILES_DIR = Join-Path $HOME 'OpenCode Profiles'
omo-profile list
```

Clear the session overrides when finished:

```powershell
Remove-Item Env:OMO_CONFIG_PATH, Env:OMO_PROFILES_DIR -ErrorAction SilentlyContinue
```

Supported variables:

- `OMO_CONFIG_PATH` overrides the active configuration path (discovery-level
  override; equivalent to `--config`).
- `OMO_CONFIG` alias for `--config`; takes precedence over `OMO_CONFIG_PATH`
  and auto-discovery, but `--config` wins over both.
- `OMO_CONFIG_DIR` overrides the directory scanned for the configuration
  filenames above.
- `OMO_PROFILES_DIR` overrides the saved profiles directory.
- `OMO_BUNDLED_PROFILES_DIR` overrides the bundled starter profiles directory.

Precedence for the active configuration:

1. `--config <path>` flag
2. `OMO_CONFIG` environment variable
3. `OMO_CONFIG_PATH` environment variable
4. Auto-discovery of the filenames above in the config directory

The `--config` flag accepts either `--config <path>` or `--config=<path>` and
may appear anywhere on the command line, making it useful for CI:

## Development

Run the test suite:

```bash
pnpm test
```

Run the CLI without installing it globally:

```bash
node agent-profile.mjs <command>
```

## Release

Releases use a protected tag named `v<package-version>`, such as `v1.0.0`,
after all required checks pass. Verify the package name and npm ownership or
availability before tagging.

```bash
pnpm test
pnpm run verify:pack
pnpm run smoke:packed
git tag v1.0.0
git push origin v1.0.0
```

Repository administrators must protect `v*` tags before using this release
path. Configure npm trusted publishing for this repository and the
`npm-release` environment so the workflow can use OIDC. If trusted publishing
is unavailable, repository administrators may provide `NPM_TOKEN` as a masked
repository secret; the workflow still publishes with provenance. Do not
publish from a branch or from an unprotected tag.

## License

MIT. See [LICENSE](LICENSE).
