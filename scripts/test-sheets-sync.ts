import { getTestTabName } from "../src/lib/google-sheets/client";
import {
  syncSequifiUsersToRosterSheet,
  testGoogleSheetsAccess,
} from "../src/lib/google-sheets/sync-roster";

async function main() {
  const tab = getTestTabName();
  console.log("Testing connection to tab:", tab);
  const conn = await testGoogleSheetsAccess(tab);
  console.log(JSON.stringify(conn, null, 2));

  console.log("\nSyncing up to 5 users...");
  const sync = await syncSequifiUsersToRosterSheet({
    tabName: tab,
    limit: 5,
    applyGoLiveFilter: true,
  });
  console.log(JSON.stringify(sync, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
