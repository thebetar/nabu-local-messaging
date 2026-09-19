import type { Database } from "bun:sqlite";
import { hostname } from "node:os";

export type Identity = {
  id: string;
  name: string;
};

type SettingRow = {
  value: string;
};

export class Settings {
  constructor(private db: Database) {
    this.db.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `).run();
  }

  getIdentity(): Identity {
    let id = this.get("id");

    if (id === null) {
      id = crypto.randomUUID();
      this.set("id", id);
    }

    const storedName = this.get("name");
    const name = storedName ?? (hostname() || "nabu-user");
    return { id, name };
  }

  hasName(): boolean {
    return this.get("name") !== null;
  }

  setName(name: string) {
    this.set("name", name);
  }

  hasNetworks(): boolean {
    return this.get("networks") !== null;
  }

  getSelectedNetworks(): string[] {
    const raw = this.get("networks");

    if (raw === null) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw) as unknown;

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter((item) => typeof item === "string");
    } catch {
      return [];
    }
  }

  setSelectedNetworks(cidrs: string[]) {
    this.set("networks", JSON.stringify(cidrs));
  }

  private get(key: string): string | null {
    const row = this.db
      .query("SELECT value FROM settings WHERE key = ?")
      .get(key) as SettingRow | null;

    if (row === null) {
      return null;
    }

    return row.value;
  }

  private set(key: string, value: string) {
    this.db.query(`
      INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }
}
