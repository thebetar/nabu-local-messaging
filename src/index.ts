#!/usr/bin/env bun

import { Store } from "./db";
import { Server, type IncomingMessage } from "./server";
import { peerScans } from "./network";
import { Cli } from "./cli";

let store: Store | undefined;

async function main() {
  store = new Store();

  const identity = store.settings.getIdentity();
  const cli = new Cli(identity, store);

  await cli.start();

  const server = new Server(identity);
  const incomingMessages = server.listen();

  await Promise.all([
    forwardMessages(incomingMessages, cli),
    forwardPeers(store, cli),
  ]);
}

async function forwardMessages(
  incomingMessages: AsyncIterable<IncomingMessage>,
  cli: Cli
) {
  for await (const message of incomingMessages) {
    cli.receive(message);
  }
}

async function forwardPeers(store: Store, cli: Cli) {
  for await (const found of peerScans(() => store.settings.getSelectedNetworks())) {
    for (const peer of found) {
      store.peers.upsert(peer);
    }

    cli.updatePeers(found);
  }
}

function shutdown() {
  store?.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main();
