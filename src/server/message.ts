import { MAX_MESSAGE_LENGTH } from "../config";
import { asTrimmedString } from "../util";

export type IncomingMessage = {
  fromId: string;
  fromName: string;
  text: string;
  ip: string;
};

export function invalidMessage(): Response {
  return Response.json({ error: "invalid message" }, { status: 400 });
}

function getClientIp(server: ReturnType<typeof Bun.serve>, request: Request): string {
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

export async function parseIncomingMessage(
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
    ip: getClientIp(server, request),
  };
}
