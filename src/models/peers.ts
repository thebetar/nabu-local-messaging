import type { Database } from "bun:sqlite";
import { nowIso } from "../util";

export type Peer = {
  id: string;
  name: string;
  ip: string;
  lastSeen: string | null;
};

export class Peers {
  constructor(private db: Database) {
    this.db.query(`
      CREATE TABLE IF NOT EXISTS peers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        ip TEXT,
        last_seen TEXT
      )
    `).run();
  }

  upsert(peer: Peer) {
    this.db.query(`
      INSERT INTO peers (id, name, ip, last_seen)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        ip = excluded.ip,
        last_seen = excluded.last_seen
    `).run(peer.id, peer.name, peer.ip, nowIso());
  }

  get(id: string): Peer | null {
    const row = this.db
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

  list(): Peer[] {
    return this.db
      .query(`
        SELECT id, name, ip, last_seen AS lastSeen
        FROM peers
        ORDER BY last_seen DESC
      `)
      .all() as Peer[];
  }
}
