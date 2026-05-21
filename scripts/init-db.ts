import { openDb, setSettings } from "../server/db";
import { DEFAULT_RULE } from "../src/domain/decision";

const db = openDb();
setSettings(db, DEFAULT_RULE);
db.close();
console.log("initialized data/boat.sqlite");
