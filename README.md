# Nabu

A small CLI for sending messages to other devices on your local network.

## Why Nabu?

The name comes from **Nabu**, the Assyrian, Armenian, and Babylonian god of writing and wisdom. That felt like the right namesake for a tool whose whole purpose is writing messages to each other.

## Why port 33954?

The port is derived from the name. Take the MD5 hash of `Nabu`, keep the last four hexadecimal characters, and convert that to decimal:

```
MD5("Nabu") = edcc114e8766d6ca2d0ebb49fb1584a2
last 4 hex  = 84a2
84a2 → 33954
```

On first start, Nabu asks for your name and which local networks to scan. It uses each interface's real CIDR, so a Docker bridge such as `172.18.0.0/16` is not treated as a /24. Small `/24` networks are selected by default because `/16` scans take much longer.

Every peer listens on that port, and every minute Nabu scans the networks you chose for other devices doing the same.

## Run

Needs [Bun](https://bun.sh). There are no runtime dependencies.

```bash
bun start
```

## Usage

Once it is running you can:

- `list` — show peers found on the network
- `scan` — search the selected networks for peers now
- `networks` — show interfaces and CIDRs
- `networks 1,3` — choose which networks to scan
- `chat <number>` — open a conversation with a peer
- `history` — show stored conversations
- `name <new-name>` — set the name other devices see
- `help` — show commands
- `quit` — exit

In a chat, type a message and press Enter. Type `q` to return to the menu.

Chat history is stored in a local SQLite database (`data/nabu.db`), which is gitignored so it stays on your machine.
