import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Settings } from "./models/settings";
import { Peers } from "./models/peers";
import { Messages } from "./models/messages";

const dataDirectory = join(import.meta.dir, "..", "data");
const databasePath = join(dataDirectory, "nabu.db");

export class Store {
  readonly settings: Settings;
  readonly peers: Peers;
  readonly messages: Messages;
  private db: Database;

  constructor() {
    mkdirSync(dataDirectory, { recursive: true });
    this.db = new Database(databasePath);
    this.settings = new Settings(this.db);
    this.peers = new Peers(this.db);
    this.messages = new Messages(this.db);
  }

  close() {
    this.db.close();
  }
}
