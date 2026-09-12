import { PORT } from "../config";
import { errorMessage } from "../util";
import { Queue } from "../queue";
import { handleInfo } from "./info";
import {
  invalidMessage,
  parseIncomingMessage,
  type IncomingMessage,
} from "./message";
import type { Identity } from "../models/settings";

export type { IncomingMessage };

async function handleMessage(
  request: Request,
  server: ReturnType<typeof Bun.serve>,
  incoming: Queue<IncomingMessage>
): Promise<Response> {
  try {
    const message = await parseIncomingMessage(request, server);

    if (message === null) {
      return invalidMessage();
    }

    incoming.push(message);
    return Response.json({ ok: true });
  } catch {
    return invalidMessage();
  }
}

function notFound(): Response {
  return Response.json({ error: "not found" }, { status: 404 });
}

export function startServer(identity: Identity): AsyncIterable<IncomingMessage> {
  const incoming = new Queue<IncomingMessage>();

  async function handleRequest(
    request: Request,
    server: ReturnType<typeof Bun.serve>
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const isGet = request.method === "GET";
    const isPost = request.method === "POST";

    if (isGet && (path === "/" || path === "/info")) {
      return handleInfo(identity);
    }

    if (isPost && path === "/message") {
      return handleMessage(request, server, incoming);
    }

    return notFound();
  }

  try {
    Bun.serve({
      port: PORT,
      hostname: "0.0.0.0",
      fetch: handleRequest,
    });
  } catch (error) {
    const message = errorMessage(error);
    const portAlreadyUsed =
      message.includes("in use") || message.includes("EADDRINUSE");

    if (portAlreadyUsed) {
      console.error(`Port ${PORT} is already in use.`);
      process.exit(1);
    }

    throw error;
  }

  return incoming;
}
