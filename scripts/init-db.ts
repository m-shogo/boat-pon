import { openDb, setSettings } from "../server/db";
import { DEFAULT_APP_RULE } from "../src/domain/decision";

const db = openDb();
setSettings(db, DEFAULT_APP_RULE);
db.close();
console.log("initialized data/boat.sqlite");
