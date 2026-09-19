import type { Database } from "bun:sqlite";
import { nowIso } from "../util";

export type MessageDirection = "in" | "out";

export type StoredMessage = {
  direction: MessageDirection;
  text: string;
  createdAt: string;
};

export class Messages {
  constructor(private db: Database) {
    this.db.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        peer_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `).run();
  }

  save(message: {
    peerId: string;
    direction: MessageDirection;
    text: string;
  }) {
    this.db.query(`
      INSERT INTO messages (peer_id, direction, text, created_at)
      VALUES (?, ?, ?, ?)
    `).run(message.peerId, message.direction, message.text, nowIso());
  }

  list(peerId: string, limit = 50): StoredMessage[] {
    const newestFirst = this.db
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
}
