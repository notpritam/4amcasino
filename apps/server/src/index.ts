import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 8787);
const { app } = createApp(process.env.DB_PATH ?? './4amcasino.db');

app
  .listen({ port, host: '0.0.0.0' })
  .then(() => console.log(`4amcasino server on :${port}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
