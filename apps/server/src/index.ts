import { createApp } from './app.js';
import { attachHub } from './hub.js';

const port = Number(process.env.PORT ?? 8787);
const { app, db } = createApp(process.env.DB_PATH ?? './4amcasino.db');
attachHub(app, db);

app
  .listen({ port, host: '0.0.0.0' })
  .then(() => console.log(`4amcasino server on :${port}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

// deploys send SIGTERM: close sockets and flush SQLite before exiting
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sig, () => {
    void app.close().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
