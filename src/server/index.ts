import { APP_NAME, MAX_MESSAGE_LENGTH, PORT } from "../config";
import { asTrimmedString, errorMessage } from "../util";
import { Queue } from "../queue";
import type { Identity } from "../models/settings";

export type IncomingMessage = {
  fromId: string;
  fromName: string;
  text: string;
  ip: string;
};

export class Server {
  private identity: Identity;
  private incoming = new Queue<IncomingMessage>();

  constructor(identity: Identity) {
    this.identity = identity;
  }

  listen(): AsyncIterable<IncomingMessage> {
    try {
      Bun.serve({
        port: PORT,
        hostname: "0.0.0.0",
        fetch: this.handleRequest.bind(this),
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

    return this.incoming;
  }

  private async handleRequest(
    request: Request,
    server: ReturnType<typeof Bun.serve>
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const isGet = request.method === "GET";
    const isPost = request.method === "POST";

    if (isGet && (path === "/" || path === "/info")) {
      return this.handleInfo();
    }

    if (isPost && path === "/message") {
      return this.handleMessage(request, server);
    }

    return this.notFound();
  }

  private handleInfo(): Response {
    return Response.json({
      app: APP_NAME,
      id: this.identity.id,
      name: this.identity.name,
    });
  }

  private async handleMessage(
    request: Request,
    server: ReturnType<typeof Bun.serve>
  ): Promise<Response> {
    try {
      const message = await this.parseIncomingMessage(request, server);

      if (message === null) {
        return this.invalidMessage();
      }

      this.incoming.push(message);
      return Response.json({ ok: true });
    } catch {
      return this.invalidMessage();
    }
  }

  private async parseIncomingMessage(
    request: Request,
    server: ReturnType<typeof Bun.serve>
  ): Promise<IncomingMessage | null> {
    const body = await request.json();

    if (typeof body !== "object" || body === null) {
      return null;
    }

    const data = body as {
      text?: unknown;
      fromId?: unknown;
      fromName?: unknown;
    };

    const text = asTrimmedString(data.text);
    const fromId = asTrimmedString(data.fromId);
    let fromName = asTrimmedString(data.fromName);

    if (fromName === "") {
      fromName = "unknown";
    }

    const hasRequiredFields = fromId !== "" && text !== "";
    const isTooLong = text.length > MAX_MESSAGE_LENGTH;

    if (!hasRequiredFields || isTooLong) {
      return null;
    }

    return {
      fromId,
      fromName,
      text,
      ip: this.getClientIp(server, request),
    };
  }

  private getClientIp(
    server: ReturnType<typeof Bun.serve>,
    request: Request
  ): string {
    const info = server.requestIP(request);
    let ip = "";

    if (info !== null) {
      ip = info.address;
    }

    if (ip.startsWith("::ffff:")) {
      ip = ip.slice("::ffff:".length);
    }

    return ip;
  }

  private invalidMessage(): Response {
    return Response.json({ error: "invalid message" }, { status: 400 });
  }

  private notFound(): Response {
    return Response.json({ error: "not found" }, { status: 404 });
  }
}
