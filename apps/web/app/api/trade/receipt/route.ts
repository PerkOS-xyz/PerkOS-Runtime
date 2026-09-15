import { txReceipt } from "../../../lib/uniswap";

// GET /api/trade/receipt?hash=0x… -> { status: pending|success|reverted, explorer }
export async function GET(req: Request) {
  const hash = new URL(req.url).searchParams.get("hash") ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return Response.json({ error: "hash" }, { status: 400 });
  return Response.json(await txReceipt(hash as `0x${string}`));
}
