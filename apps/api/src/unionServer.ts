// This process is the Union Hub service (see config.ts).
process.env.FLEXCITY_SERVICE = 'union';
import { config } from './config.js';
import { createUnionApp } from './unionApp.js';
import { assertLeastPrivilege } from './lib/dbRole.js';
import { installProcessHandlers } from './lib/errorReporter.js';

const cfg = config();
installProcessHandlers();
if (!cfg.UNION_DATABASE_URL) throw new Error('The Union Hub service needs UNION_DATABASE_URL (the flexcity_union role).');
// No APP_DATABASE_URL here: the hub holds the union role only, and the main API checks sign-ins (lib/unionAccess.ts).
await assertLeastPrivilege('UNION_DATABASE_URL', cfg.UNION_DATABASE_URL, cfg.NODE_ENV === 'production');
const port = Number(process.env.UNION_PORT ?? 4100);
// Express 5 hands a failure to bind (e.g. EADDRINUSE) to this callback instead of throwing it.
createUnionApp().listen(port, (err?: Error) => {
  if (err) {
    console.error(`FlexcityHeadquarters Union Hub could not listen on :${port}: ${err.message}`);
    process.exit(1);
  }
  console.log(`FlexcityHeadquarters Union Hub listening on :${port}`);
});
