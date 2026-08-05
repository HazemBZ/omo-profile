# omo-profile

`omo-profile` manages saved agent-model profiles for Oh My OpenAgent.
It snapshots the `agents` and `categories` sections of
`oh-my-openagent.json`, identifies the active profile, and applies saved
profiles safely.

Requires Node.js 18 or newer.

Supports Windows, macOS, and Linux. The CLI uses the same OpenCode-compatible
configuration location on each supported desktop OS.

## Install

Install the package from npm with pnpm after its public release:

```bash
pnpm add --global omo-profile
```

Verify the installation:

```bash
omo-profile help
```

The package exposes the `omo-profile` command through its `bin` entry.

The package declares pnpm as its package manager and requires Node.js 18 or
newer. After its public release, npm can also install the package if pnpm isn't
available:

```bash
npm install --global omo-profile
```

### Uninstall

Remove the globally installed CLI:

```bash
pnpm uninstall --global omo-profile
```

Uninstalling the CLI does not remove saved profiles or the active OpenAgent
configuration.

## Usage

```bash
# List saved profiles
omo-profile list
omo-profile list --json

# Show the profile matching the active configuration
omo-profile current

# Save the current configuration as a profile
omo-profile save <profile-id>

# Preview a profile switch
omo-profile switch <profile-id> --dry-run

# Apply a profile
omo-profile switch <profile-id>
```

Applying a profile creates a timestamped backup of the active configuration,
replaces only `agents` and `categories`, and preserves other top-level keys.
Restart OpenCode after switching for changes to take effect.

Profile IDs may contain letters, numbers, underscores, hyphens, and dots.

## File locations

| Purpose | Default path |
| --- | --- |
| Active configuration | `~/.config/opencode/oh-my-openagent.json` |
| Saved profiles | `~/.config/opencode/omo-profiles/` |
| Profile format | `<profile-id>.json` |

These defaults intentionally follow OpenCode's documented global configuration
location. On Windows, `~/.config/opencode` means
`%USERPROFILE%\\.config\\opencode`.

The repository currently includes profiles such as `gpt56-mixed`,
`gpt56-light`, and `deepseek-v4-flash-free`.

## Environment overrides

Use literal `OMO_CONFIG_PATH` and `OMO_PROFILES_DIR` values to point the CLI at
alternate files or directories. These are explicit overrides, not alternate
default locations.

```bash
OMO_CONFIG_PATH=/path/to/oh-my-openagent.json \
OMO_PROFILES_DIR=/path/to/profiles \
omo-profile list
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

- `OMO_CONFIG_PATH` overrides the active configuration path.
- `OMO_PROFILES_DIR` overrides the saved profiles directory.

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

Before any release, verify the package name and npm ownership or availability.
Publication has not occurred automatically. A release must use a protected tag
named `v<package-version>`, such as `v1.0.0`, after all required checks pass.

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
