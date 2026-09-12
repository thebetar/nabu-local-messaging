import type { Database } from "bun:sqlite";
import { nowIso } from "../util";

export type MessageDirection = "in" | "out";

export type StoredMessage = {
  direction: MessageDirection;
  text: string;
  createdAt: string;
};

let db: Database;

export function createTable(database: Database) {
  db = database;

  db.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      peer_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `).run();
}

export function save(message: {
  peerId: string;
  direction: MessageDirection;
  text: string;
}) {
  db.query(`
    INSERT INTO messages (peer_id, direction, text, created_at)
    VALUES (?, ?, ?, ?)
  `).run(message.peerId, message.direction, message.text, nowIso());
}

export function list(peerId: string, limit = 50): StoredMessage[] {
  const newestFirst = db
    .query(`
      SELECT direction, text, created_at AS createdAt
      FROM messages
      WHERE peer_id = ?
      ORDER BY id DESC
      LIMIT ?
    `)
    .all(peerId, limit) as StoredMessage[];

  return newestFirst.reverse();
}
