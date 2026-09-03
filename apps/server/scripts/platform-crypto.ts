// Re-exported from src so the server boot seed (index.ts), the CLI seed script,
// and the golden-vector test all share one implementation. Kept here so the
// existing import paths ('../scripts/platform-crypto.js') keep resolving.
export { derivePlatformCredentials } from '../src/platform-crypto.js';
