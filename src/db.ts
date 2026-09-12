import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createTable as createSettingsTable } from "./models/settings";
import { createTable as createPeersTable } from "./models/peers";
import { createTable as createMessagesTable } from "./models/messages";

const dataDirectory = join(import.meta.dir, "..", "data");
const databasePath = join(dataDirectory, "nabu.db");

let db: Database;

export function init() {
  mkdirSync(dataDirectory, { recursive: true });
  db = new Database(databasePath);

  createSettingsTable(db);
  createPeersTable(db);
  createMessagesTable(db);
}

export function close() {
  db.close();
}
