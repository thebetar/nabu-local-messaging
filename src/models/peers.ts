import type { Database } from "bun:sqlite";
import { nowIso } from "../util";

export type Peer = {
  id: string;
  name: string;
  ip: string;
  lastSeen: string | null;
};

let db: Database;

export function createTable(database: Database) {
  db = database;

  db.query(`
    CREATE TABLE IF NOT EXISTS peers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      ip TEXT,
      last_seen TEXT
    )
  `).run();
}

export function upsert(peer: Peer) {
  db.query(`
    INSERT INTO peers (id, name, ip, last_seen)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      ip = excluded.ip,
      last_seen = excluded.last_seen
  `).run(peer.id, peer.name, peer.ip, nowIso());
}

export function get(id: string): Peer | null {
  const row = db
    .query(`
      SELECT id, name, ip, last_seen AS lastSeen
      FROM peers
      WHERE id = ?
    `)
    .get(id) as Peer | null;

  if (row === null) {
    return null;
  }

  return row;
}

export function list(): Peer[] {
  return db
    .query(`
      SELECT id, name, ip, last_seen AS lastSeen
      FROM peers
      ORDER BY last_seen DESC
    `)
    .all() as Peer[];
}
