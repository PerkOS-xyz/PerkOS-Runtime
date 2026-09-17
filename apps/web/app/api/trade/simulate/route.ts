import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { guard } from "../../../lib/guard";
import { loadSettings } from "../../../lib/settingsStore";

// POST /api/trade/simulate { to, data, value? } -> { ok, reason? }
// Simula una transaccion del draft desde la wallet conectada, justo antes de pedir la firma.
// Sirve para el ultimo paso de una secuencia (el swap que depende de los permisos recien minados).
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { to?: unknown; data?: unknown; value?: unknown };
  const to = typeof body.to === "string" ? body.to : "", data = typeof body.data === "string" ? body.data : "", value = typeof body.value === "string" ? body.value : "0x0";
  if (!/^0x[0-9a-fA-F]{40}$/.test(to) || !/^0x[0-9a-fA-F]*$/.test(data) || !/^0x[0-9a-fA-F]+$/.test(value)) return Response.json({ error: "bad_request" }, { status: 400 });
  const s = await loadSettings();
  if (!/^0x[0-9a-fA-F]{40}$/.test(s.wallet)) return Response.json({ error: "wallet_required" }, { status: 401 });
  const c = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL?.trim() || "https://base-rpc.publicnode.com", { retryCount: 1 }) });
  try {
    await c.call({ account: s.wallet as `0x${string}`, to: to as `0x${string}`, data: data as `0x${string}`, value: BigInt(value) });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, reason: ((e as Error).message || "reverted").split("\n")[0].slice(0, 200) });
  }
}
