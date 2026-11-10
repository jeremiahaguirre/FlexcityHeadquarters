// This process is the Union Hub service (see config.ts).
process.env.FLEXCITY_SERVICE = 'union';
import { config } from './config.js';
import { createUnionApp } from './unionApp.js';

const cfg = config();
if (!cfg.UNION_DATABASE_URL) throw new Error('The Union Hub service needs UNION_DATABASE_URL (the flexcity_union role).');
const port = Number(process.env.UNION_PORT ?? 4100);
createUnionApp().listen(port, () => {
  console.log(`FlexcityHeadquarters Union Hub listening on :${port}`);
});
