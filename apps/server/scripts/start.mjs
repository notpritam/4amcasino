// Boot the prebuilt bundle when it exists (production - node starts in well
// under a second, which is most of what keeps the deploy gap short), else
// compile on the fly with tsx (fresh checkouts, `npm start` without a build).
import { existsSync } from 'node:fs';

const built = new URL('../dist/index.js', import.meta.url);
if (existsSync(built)) {
  await import(built.href);
} else {
  const { register } = await import('tsx/esm/api');
  register();
  await import('../src/index.ts');
}
