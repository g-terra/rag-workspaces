import { readFileSync } from 'node:fs';

/**
 * The release version, from this package's package.json. Release-please sets it with each
 * release (release-please-config.json), so it matches the git tag and the Docker image tag.
 */
export const VERSION: string = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
).version;
