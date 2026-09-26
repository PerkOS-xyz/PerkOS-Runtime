/** What a desk declares publicly. It never supplies chain addresses or signing instructions. */
export interface DeskIdentityDescriptor {
  version: "1";
  deskId: string;
  seats: Array<{ id: string; label: string; context: string; writes: string | null }>;
}
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every((k) => allowed.includes(k));
const short = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max && v.trim() === v;
const label = (v: unknown): v is string => typeof v === "string" && /^[a-z][a-z0-9-]{0,31}$/.test(v);

export function parseIdentityDescriptor(value: unknown): DeskIdentityDescriptor {
  const fail = (): never => { throw new Error("DESK_IDENTITY_DESCRIPTOR_INVALID"); };
  if (!object(value) || !keys(value, ["version", "deskId", "seats"]) || value.version !== "1" || !label(value.deskId) || !Array.isArray(value.seats) || value.seats.length < 1 || value.seats.length > 16) return fail();
  const ids = new Set<string>();
  const seats = value.seats.map((row: unknown) => {
    if (!object(row) || !keys(row, ["id", "label", "context", "writes"]) || !label(row.id) || ids.has(row.id) || !short(row.label, 80) || !short(row.context, 1200)) return fail();
    // Identity records stay administrative. A desk only delegates its own evidence keys.
    if (row.writes !== null && (!short(row.writes, 64) || !/^[a-z][a-z0-9-]*$/.test(row.writes) || row.writes.startsWith("agent-") || ["avatar", "description", "url"].includes(row.writes))) return fail();
    ids.add(row.id);
    return { id: row.id, label: row.label, context: row.context, writes: row.writes as string | null };
  });
  return { version: "1", deskId: value.deskId, seats };
}

/** A partial identity must never look like the identity of the whole team. */
export function assertIdentityRoster(descriptor: DeskIdentityDescriptor, publishedRoles: string[], agents: Array<{ role: string; agentId?: string }>): void {
  const expected = descriptor.seats.map((s) => s.id).sort().join(",");
  if (publishedRoles.slice().sort().join(",") !== expected || agents.map((a) => a.role).sort().join(",") !== expected ||
      agents.some((a) => !a.agentId) || new Set(agents.map((a) => a.agentId)).size !== agents.length) {
    throw new Error("ENS_TEAM_MISMATCH");
  }
}
