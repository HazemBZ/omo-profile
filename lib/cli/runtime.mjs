import { profilesDir } from '../profile-io.mjs';
import { ConfigNotFoundError, describeCheckedPaths, discoverConfig } from '../config/discover-config.mjs';
import { loadOmoConfig } from '../config/write-config.mjs';
import { ConfigStore } from '../config/config-store.mjs';
import { ProfileStore } from '../profile/profile-store.mjs';
import { createProfileDirectoryTransaction } from '../io/exclusive-lock.mjs';
import { InvalidProfileError, MissingError } from '../profile/lifecycle-errors.mjs';
import { jsonSuccess } from '../profile/lifecycle-output.mjs';

export async function loadConfig(explicitConfig) {
  try { return await loadOmoConfig({ explicitPath: explicitConfig }); }
  catch (error) {
    if (error instanceof ConfigNotFoundError) throw new MissingError(`${error.message}\n${describeCheckedPaths(error.checked)}`);
    throw new InvalidProfileError(`Cannot read config: ${error.message}`);
  }
}

export function findConfigPath(explicitConfig) {
  try { return discoverConfig({ explicitPath: explicitConfig }).path; }
  catch (error) {
    if (error instanceof ConfigNotFoundError) throw new MissingError(`${error.message}\n${describeCheckedPaths(error.checked)}`);
    throw new InvalidProfileError(`Cannot read config: ${error.message}`);
  }
}

export function profileStore() {
  const directory = profilesDir();
  return new ProfileStore({ directory, transaction: createProfileDirectoryTransaction(directory) });
}

export function configStore(explicitConfig) { return new ConfigStore({ configPath: findConfigPath(explicitConfig) }); }

export function printSuccess(showJson, resources, human) {
  console.log(showJson ? JSON.stringify(jsonSuccess(resources)) : human);
}
