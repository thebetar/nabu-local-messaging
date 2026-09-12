import type { Database } from "bun:sqlite";
import { hostname } from "node:os";

export type Identity = {
  id: string;
  name: string;
};

type SettingRow = {
  value: string;
};

let db: Database;

export function createTable(database: Database) {
  db = database;

  db.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `).run();
}

function get(key: string): string | null {
  const row = db
    .query("SELECT value FROM settings WHERE key = ?")
    .get(key) as SettingRow | null;

  if (row === null) {
    return null;
  }

  return row.value;
}

function set(key: string, value: string) {
  db.query(`
    INSERT INTO settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

export function getIdentity(): Identity {
  let id = get("id");
  let name = get("name");

  if (id === null) {
    id = crypto.randomUUID();
    set("id", id);
  }

  if (name === null) {
    name = hostname() || "nabu-user";
    set("name", name);
  }

  return { id, name };
}

export function setName(name: string) {
  set("name", name);
}
