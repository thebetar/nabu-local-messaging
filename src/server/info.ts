import { APP_NAME } from "../config";
import type { Identity } from "../models/settings";

export function handleInfo(identity: Identity): Response {
  return Response.json({
    app: APP_NAME,
    id: identity.id,
    name: identity.name,
  });
}
