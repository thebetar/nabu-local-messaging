import * as readline from "node:readline";
import * as settings from "./models/settings";
import * as storedPeers from "./models/peers";
import * as messages from "./models/messages";
import { sendMessage } from "./network";
import { PORT } from "./config";
import { errorMessage } from "./util";
import type { Identity } from "./models/settings";
import type { Peer } from "./models/peers";
import type { IncomingMessage } from "./server";

function formatTime(iso?: string): string {
  const date = iso ? new Date(iso) : new Date();

  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function createCli(identity: Identity) {
  const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let mode: "menu" | "chat" = "menu";
  let currentPeer: Peer | null = null;
  let onlinePeers: Peer[] = [];
  let isClosed = false;

  function setPrompt() {
    if (mode === "chat" && currentPeer !== null) {
      terminal.setPrompt(`${currentPeer.name}> `);
      return;
    }

    terminal.setPrompt("nabu> ");
  }

  function showPrompt() {
    setPrompt();
    terminal.prompt();
  }

  function printAbovePrompt(line: string) {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    console.log(line);
    showPrompt();
  }

  function showHelp() {
    console.log(`
Commands:
  list              Show online peers
  chat <number>     Open a chat with a peer from the list
  history           Show stored conversations
  name <new-name>   Change your display name
  help              Show this help
  quit              Exit

In a chat, type a message and press Enter.
  /back             Leave the chat
`.trim());
  }

  function showOnlinePeers() {
    if (onlinePeers.length === 0) {
      console.log("No other nabu peers found on this network yet.");
      console.log("Scanning every minute for devices on port " + PORT + ".");
      return;
    }

    console.log("Online peers:");

    for (let i = 0; i < onlinePeers.length; i++) {
      const peer = onlinePeers[i];
      const number = i + 1;
      console.log(`  ${number}. ${peer.name}  (${peer.ip})`);
    }
  }

  function showHistoryIndex() {
    const peers = storedPeers.list();

    if (peers.length === 0) {
      console.log("No stored conversations yet.");
      return;
    }

    console.log("Stored conversations:");

    for (const peer of peers) {
      const history = messages.list(peer.id, 1);
      const lastMessage = history[0];
      const preview = lastMessage ? lastMessage.text : "(no messages)";
      const lastSeen = peer.lastSeen ? formatTime(peer.lastSeen) : "unknown";

      console.log(`  ${peer.name}  last seen ${lastSeen}`);
      console.log(`    ${preview}`);
    }
  }

  function showChatHistory(peer: Peer) {
    const history = messages.list(peer.id, 50);

    console.log(`--- chat with ${peer.name} ---`);

    if (history.length === 0) {
      console.log("(no messages yet)");
      return;
    }

    for (const message of history) {
      const who = message.direction === "out" ? "You" : peer.name;
      const time = formatTime(message.createdAt);
      console.log(`[${time}] ${who}: ${message.text}`);
    }
  }

  function openChat(listNumber: number) {
    const index = listNumber - 1;
    const peer = onlinePeers[index];

    if (!peer) {
      console.log("No peer with that number. Use `list` first.");
      return;
    }

    currentPeer = peer;
    mode = "chat";
    showChatHistory(peer);
  }

  function changeName(newName: string) {
    if (newName === "") {
      console.log(`Your name is ${identity.name}`);
      return;
    }

    identity.name = newName;
    settings.setName(newName);
    console.log(`Name set to ${identity.name}`);
  }

  async function handleMenu(line: string) {
    const parts = line.split(/\s+/);
    const command = parts[0];
    const argument = parts.slice(1).join(" ").trim();

    switch (command) {
      case "help":
      case "?":
        showHelp();
        break;
      case "list":
        showOnlinePeers();
        break;
      case "history":
        showHistoryIndex();
        break;
      case "chat":
        openChat(Number(argument));
        break;
      case "name":
        changeName(argument);
        break;
      case "quit":
      case "exit":
        terminal.close();
        break;
      default:
        if (command !== "") {
          console.log(`Unknown command "${command}". Type help.`);
        }
    }
  }

  async function handleChat(line: string) {
    if (line === "/back" || line === "/menu") {
      mode = "menu";
      currentPeer = null;
      console.log("Back to menu.");
      return;
    }

    if (line === "/help") {
      showHelp();
      return;
    }

    if (currentPeer === null) {
      mode = "menu";
      return;
    }

    try {
      await sendMessage(currentPeer.ip, identity, line);
      messages.save({
        peerId: currentPeer.id,
        direction: "out",
        text: line,
      });
      console.log(`[${formatTime()}] You: ${line}`);
    } catch (error) {
      console.log(`Could not send: ${errorMessage(error)}`);
    }
  }

  terminal.on("line", async (input) => {
    const line = input.trim();

    try {
      if (mode === "chat") {
        if (line !== "") {
          await handleChat(line);
        }
      } else {
        await handleMenu(line);
      }
    } catch (error) {
      console.error(errorMessage(error));
    }

    if (!isClosed) {
      showPrompt();
    }
  });

  terminal.on("close", () => {
    isClosed = true;
    process.exit(0);
  });

  return {
    start(ipAddresses: string[]) {
      const addressList =
        ipAddresses.length > 0 ? ipAddresses.join(", ") : "localhost";

      console.log("nabu local messaging");
      console.log(
        `You are "${identity.name}" — listening on ${addressList}:${PORT}`
      );
      showHelp();
      showPrompt();
    },

    updatePeers(peers: Peer[]) {
      const previousIds = new Set<string>();
      for (const peer of onlinePeers) {
        previousIds.add(peer.id);
      }

      onlinePeers = [];
      for (const peer of peers) {
        if (peer.id !== identity.id) {
          onlinePeers.push(peer);
        }
      }

      for (const peer of onlinePeers) {
        const isNew = !previousIds.has(peer.id);
        if (isNew) {
          printAbovePrompt(`Peer found: ${peer.name} (${peer.ip})`);
        }
      }
    },

    receive(message: IncomingMessage) {
      storedPeers.upsert({
        id: message.fromId,
        name: message.fromName,
        ip: message.ip,
        lastSeen: null,
      });
      messages.save({
        peerId: message.fromId,
        direction: "in",
        text: message.text,
      });

      const chattingWithSender =
        mode === "chat" &&
        currentPeer !== null &&
        currentPeer.id === message.fromId;

      if (chattingWithSender && currentPeer !== null) {
        currentPeer.name = message.fromName;
        const time = formatTime();
        printAbovePrompt(
          `[${time}] ${message.fromName}: ${message.text}`
        );
      } else {
        printAbovePrompt(
          `Message from ${message.fromName}: ${message.text}`
        );
      }
    },
  };
}
