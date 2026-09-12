#!/usr/bin/env bun

import * as db from "./db";
import * as settings from "./models/settings";
import * as storedPeers from "./models/peers";
import { startServer, type IncomingMessage } from "./server";
import { peerScans, getLocalIpAddresses } from "./network";
import { createCli } from "./cli";

async function main() {
  db.init();

  const identity = settings.getIdentity();
  const cli = createCli(identity);
  const incomingMessages = startServer(identity);

  cli.start(getLocalIpAddresses());

  await Promise.all([
    forwardMessages(incomingMessages, cli),
    forwardPeers(cli),
  ]);
}

async function forwardMessages(
  incomingMessages: AsyncIterable<IncomingMessage>,
  cli: ReturnType<typeof createCli>
) {
  for await (const message of incomingMessages) {
    cli.receive(message);
  }
}

async function forwardPeers(cli: ReturnType<typeof createCli>) {
  for await (const found of peerScans()) {
    for (const peer of found) {
      storedPeers.upsert(peer);
    }

    cli.updatePeers(found);
  }
}

function shutdown() {
  db.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main();
