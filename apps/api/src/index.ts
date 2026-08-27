import { createApp } from './app.js';
import { env, activeVisionProvider } from './config/env.js';

const app = createApp();
app.listen(env.port, () => {
  console.log(`[dimolvision-api] listening on :${env.port} (vision provider: ${activeVisionProvider()})`);
});
