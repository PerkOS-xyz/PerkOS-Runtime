/**
 * The contract a Desk fulfils, shared by three sides: the desk that answers,
 * the PerkOS API that registers and proxies it, and the client that draws it.
 *
 * It is versioned because they ship apart. A desk states which version it
 * speaks, and a Runtime that does not know that version says so instead of
 * half-drawing an answer it does not understand.
 */

export const DESK_CONTRACT_VERSION = "1";

export * from "./manifest.ts";
export * from "./market.ts";
export * from "./series.ts";
export * from "./order.ts";
