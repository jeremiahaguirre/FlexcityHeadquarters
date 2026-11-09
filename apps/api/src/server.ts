import { createApp } from './app.js';
import { config } from './config.js';

const { PORT } = config();
createApp().listen(PORT, () => {
  console.log(`flexcity api listening on :${PORT}`);
});
