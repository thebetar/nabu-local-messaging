import { networkInterfaces } from "node:os";
import {
  APP_NAME,
  MIN_SCAN_PREFIX,
  PORT,
  PROBE_TIMEOUT_MS,
  SCAN_CONCURRENCY,
  SCAN_INTERVAL_MS,
  SEND_TIMEOUT_MS,
} from "./config";
import { errorMessage, asTrimmedString } from "./util";
import type { Identity } from "./models/settings";
import type { Peer } from "./models/peers";

export type LocalNetwork = {
  cidr: string;
  prefix: number;
  hostCount: number;
  ips: string[];
  slow: boolean;
};

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function intToIpv4(value: number): string {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join(".");
}

function prefixFromNetmask(netmask: string): number {
  const bits = ipv4ToInt(netmask);
  let prefix = 0;

  for (let i = 31; i >= 0; i--) {
    if (((bits >>> i) & 1) === 0) {
      break;
    }

    prefix += 1;
  }

  return prefix;
}

function prefixOf(address: string, netmask: string, cidr: string | null): number {
  if (cidr !== null) {
    const prefix = Number(cidr.split("/")[1]);

    if (Number.isFinite(prefix)) {
      return prefix;
    }
  }

  return prefixFromNetmask(netmask);
}

function hostCountForPrefix(prefix: number): number {
  const hostBits = 32 - prefix;

  if (hostBits <= 0) {
    return 1;
  }

  if (hostBits >= 31) {
    return 2 ** hostBits;
  }

  return 2 ** hostBits - 2;
}

function networkCidr(address: string, prefix: number): string {
  const shift = 32 - prefix;
  const network =
    prefix === 0 ? 0 : ((ipv4ToInt(address) >>> shift) << shift) >>> 0;
  return `${intToIpv4(network)}/${prefix}`;
}

export function getLocalNetworks(): LocalNetwork[] {
  const byCidr = new Map<string, LocalNetwork>();
  const interfaces = networkInterfaces();

  for (const addrs of Object.values(interfaces)) {
    if (!addrs) {
      continue;
    }

    for (const addr of addrs) {
      if (addr.family !== "IPv4" || addr.internal) {
        continue;
      }

      const prefix = prefixOf(addr.address, addr.netmask, addr.cidr);
      const cidr = networkCidr(addr.address, prefix);
      const existing = byCidr.get(cidr);

      if (existing) {
        existing.ips.push(addr.address);
        continue;
      }

      byCidr.set(cidr, {
        cidr,
        prefix,
        hostCount: hostCountForPrefix(prefix),
        ips: [addr.address],
        slow: prefix < 24,
      });
    }
  }

  return [...byCidr.values()];
}

export function getLocalIpAddresses(): string[] {
  const ips: string[] = [];

  for (const network of getLocalNetworks()) {
    for (const ip of network.ips) {
      ips.push(ip);
    }
  }

  return ips;
}

function isTypicalHomeLan(network: LocalNetwork): boolean {
  if (network.prefix < 24) {
    return false;
  }

  const ip = network.ips[0];

  if (!ip) {
    return false;
  }

  const parts = ip.split(".").map(Number);
  return parts[0] === 192 && parts[1] === 168;
}

export function defaultNetworkCidrs(): string[] {
  const networks = getLocalNetworks();
  const home = networks.filter(isTypicalHomeLan);

  if (home.length > 0) {
    return home.map((network) => network.cidr);
  }

  return networks
    .filter((network) => network.prefix >= 24)
    .map((network) => network.cidr);
}

function hostsInCidr(cidr: string, skipIps: Set<string>): string[] {
  const [ip, prefixText] = cidr.split("/");
  const prefix = Number(prefixText);
  const hostBits = 32 - prefix;
  const size = 2 ** hostBits;
  const network = ipv4ToInt(ip);
  const first = prefix >= 31 ? network : network + 1;
  const last = prefix >= 31 ? network + size - 1 : network + size - 2;
  const ips: string[] = [];

  for (let value = first; value <= last; value++) {
    const host = intToIpv4(value);

    if (!skipIps.has(host)) {
      ips.push(host);
    }
  }

  return ips;
}

function collectIpsToScan(cidrs: string[]): string[] {
  const skipIps = new Set(getLocalIpAddresses());
  const uniqueIps = new Set<string>();

  for (const cidr of cidrs) {
    const prefix = Number(cidr.split("/")[1]);

    if (!Number.isFinite(prefix) || prefix < MIN_SCAN_PREFIX) {
      continue;
    }

    for (const ip of hostsInCidr(cidr, skipIps)) {
      uniqueIps.add(ip);
    }
  }

  return [...uniqueIps];
}

async function probeForNabuPeer(ip: string): Promise<Peer | null> {
  try {
    const url = `http://${ip}:${PORT}/info`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const body = await response.json();

    if (typeof body !== "object" || body === null) {
      return null;
    }

    const data = body as { app?: unknown; id?: unknown; name?: unknown };
    const app = asTrimmedString(data.app);
    const id = asTrimmedString(data.id);
    const name = asTrimmedString(data.name);

    const isNabu = app === APP_NAME;
    const hasId = id !== "";
    const hasName = name !== "";

    if (isNabu && hasId && hasName) {
      return {
        id,
        name,
        ip,
        lastSeen: null,
      };
    }
  } catch {
    return null;
  }

  return null;
}

async function probeMany(ipAddresses: string[]): Promise<(Peer | null)[]> {
  const results: (Peer | null)[] = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < ipAddresses.length) {
      const index = nextIndex;
      nextIndex += 1;
      const ip = ipAddresses[index];
      results[index] = await probeForNabuPeer(ip);
    }
  }

  const workerCount = Math.min(SCAN_CONCURRENCY, ipAddresses.length);
  const workers: Promise<void>[] = [];

  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

export async function scanNetwork(cidrs: string[]): Promise<Peer[]> {
  const ipsToScan = collectIpsToScan(cidrs);

  if (ipsToScan.length === 0) {
    return [];
  }

  const results = await probeMany(ipsToScan);
  const peers: Peer[] = [];

  for (const result of results) {
    if (result !== null) {
      peers.push(result);
    }
  }

  return peers;
}

export async function sendMessage(
  ip: string,
  identity: Identity,
  text: string
) {
  const url = `http://${ip}:${PORT}/message`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fromId: identity.id,
      fromName: identity.name,
      text,
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`peer returned ${response.status}`);
  }
}

export async function* peerScans(
  getCidrs: () => string[]
): AsyncIterable<Peer[]> {
  while (true) {
    const startedAt = Date.now();

    try {
      yield await scanNetwork(getCidrs());
    } catch (error) {
      console.error("scan failed:", errorMessage(error));
    }

    const elapsed = Date.now() - startedAt;
    await Bun.sleep(Math.max(0, SCAN_INTERVAL_MS - elapsed));
  }
}
