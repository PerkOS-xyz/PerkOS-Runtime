import { PerkosApiError } from "@perkos/client";

/** JSON error for a failed PerkOS call. Status 0 (unreachable) becomes 502. */
export function errorResponse(err: unknown): Response {
  if (err instanceof PerkosApiError) {
    const status = err.status >= 400 && err.status < 600 ? err.status : 502;
    return Response.json({ error: err.code, message: err.message }, { status });
  }
  return Response.json({ error: "internal", message: (err as Error).message }, { status: 500 });
}
