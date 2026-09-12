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

Every peer listens on that port, and every minute Nabu scans the local network for other devices doing the same.

## Run

Needs [Bun](https://bun.sh). There are no runtime dependencies.

```bash
bun start
```

## Usage

Once it is running you can:

- `list` — show peers found on the network
- `chat <number>` — open a conversation with a peer
- `history` — show stored conversations
- `name <new-name>` — set the name other devices see
- `help` — show commands
- `quit` — exit

In a chat, type a message and press Enter. Use `/back` to return to the menu.

Chat history is stored in a local SQLite database (`data/nabu.db`), which is gitignored so it stays on your machine.
