import { networkInterfaces } from "node:os";
import {
  APP_NAME,
  PORT,
  PROBE_TIMEOUT_MS,
  SCAN_CONCURRENCY,
  SCAN_INTERVAL_MS,
  SEND_TIMEOUT_MS,
} from "./config";
import { errorMessage, asTrimmedString } from "./util";
import type { Identity } from "./models/settings";
import type { Peer } from "./models/peers";

export function getLocalIpAddresses(): string[] {
  const addresses: string[] = [];
  const interfaces = networkInterfaces();

  for (const addrs of Object.values(interfaces)) {
    if (!addrs) {
      continue;
    }

    for (const addr of addrs) {
      const isIpv4 = addr.family === "IPv4";
      const isRealNetwork = !addr.internal;

      if (isIpv4 && isRealNetwork) {
        addresses.push(addr.address);
      }
    }
  }

  return addresses;
}

function getIpsOnSameSubnet(ourIp: string): string[] {
  const parts = ourIp.split(".");
  const first = Number(parts[0]);
  const second = Number(parts[1]);
  const third = Number(parts[2]);
  const ourLast = Number(parts[3]);

  const ips: string[] = [];

  for (let last = 1; last <= 254; last++) {
    if (last === ourLast) {
      continue;
    }

    ips.push(`${first}.${second}.${third}.${last}`);
  }

  return ips;
}

function collectIpsToScan(): string[] {
  const uniqueIps = new Set<string>();

  for (const localIp of getLocalIpAddresses()) {
    for (const neighborIp of getIpsOnSameSubnet(localIp)) {
      uniqueIps.add(neighborIp);
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

export async function scanNetwork(): Promise<Peer[]> {
  const ipsToScan = collectIpsToScan();

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

export async function* peerScans(): AsyncIterable<Peer[]> {
  while (true) {
    const startedAt = Date.now();

    try {
      yield await scanNetwork();
    } catch (error) {
      console.error("scan failed:", errorMessage(error));
    }

    const elapsed = Date.now() - startedAt;
    await Bun.sleep(Math.max(0, SCAN_INTERVAL_MS - elapsed));
  }
}
