import * as readline from "node:readline";
import { hostname } from "node:os";
import {
  scanNetwork,
  sendMessage,
  getLocalNetworks,
  defaultNetworkCidrs,
  type LocalNetwork,
} from "./network";
import { MIN_SCAN_PREFIX, PORT } from "./config";
import { errorMessage } from "./util";
import type { Store } from "./db";
import type { Identity } from "./models/settings";
import type { Peer } from "./models/peers";
import type { IncomingMessage } from "./server";

export class Cli {
  private store: Store;
  private identity: Identity;
  private terminal: readline.Interface;
  private mode: "menu" | "chat" = "menu";
  private currentPeer: Peer | null = null;
  private onlinePeers: Peer[] = [];
  private isClosed = false;

  constructor(identity: Identity, store: Store) {
    this.identity = identity;
    this.store = store;
    this.terminal = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    this.terminal.on("close", () => {
      this.onClose();
    });
  }

  async start() {
    await this.ensureConfigured();

    this.terminal.on("line", (input) => {
      void this.onLine(input);
    });

    console.log("nabu local messaging");
    console.log(`You are "${this.identity.name}" — listening on port ${PORT}`);
    this.showLocalNetworks();
    this.showHelp();
    this.showPrompt();
  }

  updatePeers(peers: Peer[]) {
    const newlyFound = this.setOnlinePeers(peers);

    for (const peer of newlyFound) {
      this.printAbovePrompt(`Peer found: ${peer.name} (${peer.ip})`);
    }
  }

  receive(message: IncomingMessage) {
    this.store.peers.upsert({
      id: message.fromId,
      name: message.fromName,
      ip: message.ip,
      lastSeen: null,
    });
    this.store.messages.save({
      peerId: message.fromId,
      direction: "in",
      text: message.text,
    });

    const chattingWithSender =
      this.mode === "chat" &&
      this.currentPeer !== null &&
      this.currentPeer.id === message.fromId;

    if (chattingWithSender && this.currentPeer !== null) {
      this.currentPeer.name = message.fromName;
      const time = this.formatTime();
      this.printAbovePrompt(`[${time}] ${message.fromName}: ${message.text}`);
    } else {
      this.printAbovePrompt(`Message from ${message.fromName}: ${message.text}`);
    }
  }

  private async ensureConfigured() {
    if (!this.store.settings.hasName()) {
      await this.askName();
    }

    if (!this.store.settings.hasNetworks()) {
      await this.askNetworks();
    }
  }

  private ask(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.terminal.question(question, (answer) => {
        resolve(answer.trim());
      });
    });
  }

  private async askName() {
    const suggested = this.identity.name || hostname() || "nabu-user";
    const answer = await this.ask(`What is your name? [${suggested}] `);
    const name = answer === "" ? suggested : answer;
    this.identity.name = name;
    this.store.settings.setName(name);
  }

  private async askNetworks() {
    const networks = getLocalNetworks();

    if (networks.length === 0) {
      this.store.settings.setSelectedNetworks([]);
      console.log("No local IPv4 networks found.");
      return;
    }

    const defaults = defaultNetworkCidrs();
    const defaultNumbers = networks
      .map((network, index) =>
        defaults.includes(network.cidr) ? String(index + 1) : ""
      )
      .filter((value) => value !== "")
      .join(",");

    console.log("Which networks should Nabu scan and communicate on?");
    this.printNetworkChoices(new Set(defaults));
    console.log(
      "Home 192.168.x.x /24 networks are selected by default. VPN and Docker nets are left off unless you pick them."
    );

    while (true) {
      const answer = await this.ask(
        `Select networks (e.g. 1,3) [${defaultNumbers || "none"}] `
      );
      const cidrs = this.cidrsFromSelection(answer, defaults);

      if (cidrs === null) {
        console.log("Invalid selection. Use the numbers from the list.");
        continue;
      }

      this.store.settings.setSelectedNetworks(cidrs);
      return;
    }
  }

  private printNetworkChoices(selected: Set<string>) {
    const networks = getLocalNetworks();

    for (let i = 0; i < networks.length; i++) {
      const network = networks[i];
      const mark = selected.has(network.cidr) ? "*" : " ";
      console.log(`  ${i + 1}. [${mark}] ${this.formatNetwork(network)}`);
    }
  }

  private formatNetwork(network: LocalNetwork): string {
    const ips = network.ips.join(", ");
    const slow = network.slow ? ", slow" : "";
    return `${network.cidr}  (${ips}, ${network.hostCount} hosts${slow})`;
  }

  private cidrsFromSelection(
    input: string,
    fallback: string[]
  ): string[] | null {
    if (input === "") {
      return fallback;
    }

    const networks = getLocalNetworks();
    const parts = input.split(/[,\s]+/).filter((part) => part !== "");
    const cidrs: string[] = [];

    for (const part of parts) {
      const network = networks[Number(part) - 1];

      if (!network) {
        return null;
      }

      if (network.prefix < MIN_SCAN_PREFIX) {
        return null;
      }

      if (!cidrs.includes(network.cidr)) {
        cidrs.push(network.cidr);
      }
    }

    return cidrs;
  }

  private setPrompt() {
    if (this.mode === "chat" && this.currentPeer !== null) {
      this.terminal.setPrompt(`${this.currentPeer.name}> `);
      return;
    }

    this.terminal.setPrompt("nabu> ");
  }

  private showPrompt() {
    this.setPrompt();
    this.terminal.prompt();
  }

  private printAbovePrompt(line: string) {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    console.log(line);
    this.showPrompt();
  }

  private showHelp() {
    console.log(`
Commands:
  list              Show online peers
  scan              Search the local network for peers now
  networks          Show available networks
  networks 1,3      Choose which networks to scan
  chat <number>     Open a chat with a peer from the list
  history           Show stored conversations
  name <new-name>   Change your display name
  help              Show this help
  quit              Exit

In a chat, type a message and press Enter.
  q                 Leave the chat
`.trim());
  }

  private showLocalNetworks() {
    const networks = getLocalNetworks();
    const selected = this.store.settings.getSelectedNetworks();

    if (networks.length === 0) {
      console.log("Your addresses: none");
      console.log("Scanning: none");
      return;
    }

    console.log("Your addresses:");
    for (const network of networks) {
      for (const ip of network.ips) {
        console.log(`  ${ip}  (${network.cidr})`);
      }
    }

    console.log("Scanning:");
    if (selected.length === 0) {
      console.log("  none");
      return;
    }

    for (const cidr of selected) {
      console.log(`  ${cidr}`);
    }
  }

  private showNetworkConfig() {
    const selected = new Set(this.store.settings.getSelectedNetworks());
    const networks = getLocalNetworks();

    if (networks.length === 0) {
      console.log("No local IPv4 networks found.");
      return;
    }

    console.log("Available networks (* = selected):");
    this.printNetworkChoices(selected);
    console.log("Use `networks 1,3` to change. Home LAN is usually 192.168.x.0/24.");
  }

  private changeNetworks(selection: string) {
    if (selection === "") {
      this.showNetworkConfig();
      return;
    }

    const cidrs = this.cidrsFromSelection(selection, []);

    if (cidrs === null) {
      console.log("Invalid selection. Use `networks` to see the list.");
      return;
    }

    this.store.settings.setSelectedNetworks(cidrs);
    console.log("Now scanning:");

    if (cidrs.length === 0) {
      console.log("  none");
      return;
    }

    for (const cidr of cidrs) {
      console.log(`  ${cidr}`);
    }
  }

  private showOnlinePeers() {
    if (this.onlinePeers.length === 0) {
      console.log("No other nabu peers found on this network yet.");
      console.log("Scanning every minute for devices on port " + PORT + ".");
      return;
    }

    console.log("Online peers:");

    for (let i = 0; i < this.onlinePeers.length; i++) {
      const peer = this.onlinePeers[i];
      const number = i + 1;
      console.log(`  ${number}. ${peer.name}  (${peer.ip})`);
    }
  }

  private setOnlinePeers(peers: Peer[]) {
    const previousIds = new Set<string>();
    for (const peer of this.onlinePeers) {
      previousIds.add(peer.id);
    }

    this.onlinePeers = [];
    for (const peer of peers) {
      if (peer.id !== this.identity.id) {
        this.onlinePeers.push(peer);
      }
    }

    const newlyFound: Peer[] = [];
    for (const peer of this.onlinePeers) {
      if (!previousIds.has(peer.id)) {
        newlyFound.push(peer);
      }
    }

    return newlyFound;
  }

  private async runScan() {
    const cidrs = this.store.settings.getSelectedNetworks();

    this.showLocalNetworks();

    if (cidrs.length === 0) {
      console.log("No networks selected. Use `networks` to choose some.");
      return;
    }

    const networks = getLocalNetworks();
    const slow = cidrs.some((cidr) =>
      networks.find((network) => network.cidr === cidr)?.slow
    );

    if (slow) {
      console.log("Scanning now (wide networks can take several minutes)...");
    } else {
      console.log("Scanning now...");
    }

    const found = await scanNetwork(cidrs);

    for (const peer of found) {
      this.store.peers.upsert(peer);
    }

    this.setOnlinePeers(found);
    this.showOnlinePeers();
  }

  private showHistoryIndex() {
    const peers = this.store.peers.list();

    if (peers.length === 0) {
      console.log("No stored conversations yet.");
      return;
    }

    console.log("Stored conversations:");

    for (const peer of peers) {
      const history = this.store.messages.list(peer.id, 1);
      const lastMessage = history[0];
      const preview = lastMessage ? lastMessage.text : "(no messages)";
      const lastSeen = peer.lastSeen ? this.formatTime(peer.lastSeen) : "unknown";

      console.log(`  ${peer.name}  last seen ${lastSeen}`);
      console.log(`    ${preview}`);
    }
  }

  private showChatHistory(peer: Peer) {
    const history = this.store.messages.list(peer.id, 50);

    console.log(`--- chat with ${peer.name} ---`);

    if (history.length === 0) {
      console.log("(no messages yet)");
      return;
    }

    for (const message of history) {
      const who = message.direction === "out" ? "You" : peer.name;
      const time = this.formatTime(message.createdAt);
      console.log(`[${time}] ${who}: ${message.text}`);
    }
  }

  private openChat(listNumber: number) {
    const index = listNumber - 1;
    const peer = this.onlinePeers[index];

    if (!peer) {
      console.log("No peer with that number. Use `list` first.");
      return;
    }

    this.currentPeer = peer;
    this.mode = "chat";
    this.showChatHistory(peer);
    console.log("Type a message and press Enter. Type q to leave.");
  }

  private changeName(newName: string) {
    if (newName === "") {
      console.log(`Your name is ${this.identity.name}`);
      return;
    }

    this.identity.name = newName;
    this.store.settings.setName(newName);
    console.log(`Name set to ${this.identity.name}`);
  }

  private async handleMenu(line: string) {
    const parts = line.split(/\s+/);
    const command = parts[0];
    const argument = parts.slice(1).join(" ").trim();

    switch (command) {
      case "help":
      case "?":
        this.showHelp();
        break;
      case "list":
        this.showOnlinePeers();
        break;
      case "scan":
        await this.runScan();
        break;
      case "networks":
        this.changeNetworks(argument);
        break;
      case "history":
        this.showHistoryIndex();
        break;
      case "chat":
        this.openChat(Number(argument));
        break;
      case "name":
        this.changeName(argument);
        break;
      case "quit":
      case "exit":
        this.terminal.close();
        break;
      default:
        if (command !== "") {
          console.log(`Unknown command "${command}". Type help.`);
        }
    }
  }

  private leaveChat() {
    this.mode = "menu";
    this.currentPeer = null;
    console.log("Back to menu.");
  }

  private async handleChat(line: string) {
    if (line === "q" || line === "/back" || line === "/menu") {
      this.leaveChat();
      return;
    }

    if (line === "/help") {
      this.showHelp();
      return;
    }

    if (this.currentPeer === null) {
      this.mode = "menu";
      return;
    }

    try {
      await sendMessage(this.currentPeer.ip, this.identity, line);
      this.store.messages.save({
        peerId: this.currentPeer.id,
        direction: "out",
        text: line,
      });
      console.log(`[${this.formatTime()}] You: ${line}`);
    } catch (error) {
      console.log(`Could not send: ${errorMessage(error)}`);
    }
  }

  private async onLine(input: string) {
    const line = input.trim();

    try {
      if (this.mode === "chat") {
        if (line !== "") {
          await this.handleChat(line);
        }
      } else {
        await this.handleMenu(line);
      }
    } catch (error) {
      console.error(errorMessage(error));
    }

    if (!this.isClosed) {
      this.showPrompt();
    }
  }

  private onClose() {
    this.isClosed = true;
    process.exit(0);
  }

  private formatTime(iso?: string): string {
    const date = iso ? new Date(iso) : new Date();

    if (Number.isNaN(date.getTime())) {
      return "--:--";
    }

    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
}
