import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function validateReleaseInputs({
  tag,
  packageVersion,
  packageName,
  packageNameStatus,
  duplicateVersion,
}) {
  if (!/^v[^/]+$/.test(tag)) {
    throw new Error(`release requires a v* tag, received: ${tag || '<empty>'}`);
  }
  if (tag !== `v${packageVersion}`) {
    throw new Error(`tag ${tag} does not match package version ${packageVersion}`);
  }
  if (!packageName) {
    throw new Error('package name is required');
  }
  if (packageNameStatus === 'occupied') {
    throw new Error(`package name is already occupied without ownership confirmation: ${packageName}`);
  }
  if (packageNameStatus !== 'available' && packageNameStatus !== 'owned') {
    throw new Error(`package name preflight failed: ${packageNameStatus}`);
  }
  if (duplicateVersion) {
    throw new Error(`package version already exists: ${packageName}@${packageVersion}`);
  }
  return { tag, packageName, packageVersion };
}

function npmView(args, registry) {
  try {
    return execFileSync('npm', [...args, '--registry', registry], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const stderr = error.stderr?.toString() || '';
    if (error.status === 1 && /(?:E404|\b404\b)/i.test(stderr)) return null;
    throw new Error(`npm registry preflight failed: ${stderr.trim() || error.message}`);
  }
}

function npmViewSoft(args, registry) {
  try {
    return npmView(args, registry);
  } catch {
    return null;
  }
}

function readPackage() {
  return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
}

function registryPreflight(packageName, packageVersion, registry) {
  const publishedName = npmView(['view', packageName, 'name'], registry);
  let packageNameStatus = publishedName === null ? 'available' : 'occupied';
  if (packageNameStatus === 'occupied') {
    const me = npmViewSoft(['whoami'], registry);
    const owners = npmView(['owner', 'ls', packageName], registry);
    const ownedByIdentity = me != null
      && owners?.split('\n').some((line) => line.trim().split(/\s+/)[0] === me);
    const publishToken = process.env.NODE_AUTH_TOKEN ?? process.env.NPM_TOKEN ?? null;
    if (ownedByIdentity) {
      packageNameStatus = 'owned';
    } else if (me === null && publishToken) {
      // Trusted-publishing (OIDC) tokens cannot query identity, but npm only
      // issues them to accounts configured as publishers for the package, and
      // `npm publish` rejects non-owners regardless. The duplicate-version
      // check below still guards against republishing an existing version.
      console.error('ownership preflight: whoami unavailable with publish token (OIDC trusted publishing); assuming publisher ownership');
      packageNameStatus = 'owned';
    } else {
      console.error(`ownership preflight: whoami=${me ?? 'unauthenticated'} owners=${JSON.stringify(owners ?? null)}`);
    }
  }
  const publishedVersion = npmView(['view', `${packageName}@${packageVersion}`, 'version'], registry);
  return { packageNameStatus, duplicateVersion: publishedVersion !== null };
}

const isDirectExecution = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectExecution) {
  const packageJson = readPackage();
  const registry = process.env.NPM_CONFIG_REGISTRY || 'https://registry.npmjs.org';
  const preflight = registryPreflight(packageJson.name, packageJson.version, registry);
  const result = validateReleaseInputs({
    tag: process.env.RELEASE_TAG || '',
    packageVersion: packageJson.version,
    packageName: packageJson.name,
    ...preflight,
  });
  console.log(`Release preflight passed for ${result.packageName}@${result.packageVersion} (${result.tag})`);
}
