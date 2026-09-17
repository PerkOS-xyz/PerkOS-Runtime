import { guard } from "../../lib/guard";

// POST /api/rpc -> JSON-RPC de Base por el RPC del install (BASE_RPC_URL, Alchemy).
// El proveedor de la wallet en la ventana (Privy, WalletConnect) lee bloques y
// estima gas contra un RPC de la cadena; el publico de Base rechaza esas llamadas
// desde el app ("RPC endpoint returned HTTP client error") y la firma ni llega al
// celular. Este proxy mantiene la key en el servidor: el cliente solo ve /api/rpc.
// Solo metodos de lectura y el envio de una tx YA firmada; nada que firme.
const ALLOWED = new Set([
  "eth_chainId", "net_version", "eth_blockNumber", "eth_getBlockByNumber", "eth_getBlockByHash",
  "eth_call", "eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory",
  "eth_getBalance", "eth_getCode", "eth_getStorageAt", "eth_getTransactionCount",
  "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getLogs", "eth_sendRawTransaction"
]);
type Call = { jsonrpc?: string; id?: unknown; method?: unknown; params?: unknown };

const upstream = () => process.env.BASE_RPC_URL?.trim() || "https://base-rpc.publicnode.com";
const deny = (c: Call, message: string) => ({ jsonrpc: "2.0", id: c.id ?? null, error: { code: -32601, message } });

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const raw = await req.text();
  if (raw.length > 200_000) return Response.json({ error: "too_large" }, { status: 413 });
  let body: Call | Call[];
  try { body = JSON.parse(raw) as Call | Call[]; } catch { return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, { status: 400 }); }
  const calls = Array.isArray(body) ? body : [body];
  if (!calls.length || calls.length > 50) return Response.json({ error: "batch" }, { status: 400 });
  const bad = calls.find((c) => typeof c.method !== "string" || !ALLOWED.has(c.method));
  if (bad) {
    const out = calls.map((c) => (typeof c.method === "string" && ALLOWED.has(c.method) ? deny(c, "rejected with the batch") : deny(c, `method not allowed: ${String(c.method)}`)));
    return Response.json(Array.isArray(body) ? out : out[0]);
  }
  try {
    const r = await fetch(upstream(), { method: "POST", headers: { "Content-Type": "application/json" }, body: raw, signal: AbortSignal.timeout(20_000) });
    const text = await r.text();
    return new Response(text, { status: r.ok ? 200 : 502, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return Response.json({ jsonrpc: "2.0", id: Array.isArray(body) ? null : body.id ?? null, error: { code: -32000, message: `rpc upstream: ${(e as Error).message}` } }, { status: 502 });
  }
}
