import { getSheetsClient, getSpreadsheetId, getTestTabName } from "../src/lib/google-sheets/client";

async function main() {
  const tab = getTestTabName();
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: `'${tab.replace(/'/g, "''")}'!A1:T20`,
  });
  console.log("Tab:", tab);
  console.log("Rows:", (res.data.values ?? []).length);
  for (const row of res.data.values ?? []) {
    console.log(row.slice(0, 6).join(" | "));
  }
}

main().catch(console.error);
