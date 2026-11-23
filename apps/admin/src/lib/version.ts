declare const __APP_VERSION__: string;

/**
 * The release this UI was built from: the root package.json's version, which release-please bumps
 * with every release (release-please-config.json). Vite writes it in at build time (vite.config.ts).
 */
export const APP_VERSION: string = __APP_VERSION__;
