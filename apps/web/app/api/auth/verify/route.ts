import { verifyMessage } from "viem";
import { takeNonce } from "../../../lib/nonceStore";
import { loadSettings, publicSettings, saveSettings } from "../../../lib/settingsStore";

type Body = { address?: string; nonce?: string; signature?: string };

export async function POST(req: Request) {
  const body = (await req.json()) as Body;
  const address = body.address?.trim() ?? "";
  const nonce = body.nonce?.trim() ?? "";
  const signature = body.signature?.trim() ?? "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(address) || !nonce || !signature) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const row = takeNonce(nonce, address);
  if (!row) return Response.json({ error: "invalid_grant" }, { status: 400 });
  let ok = false;
  try {
    ok = await verifyMessage({
      address: address as `0x${string}`,
      message: row.message,
      signature: signature as `0x${string}`
    });
  } catch {
    ok = false;
  }
  if (!ok) return Response.json({ error: "invalid_signature" }, { status: 401 });
  const cur = await loadSettings();
  await saveSettings({ ...cur, wallet: address.toLowerCase() });
  return Response.json({ ok: true, ...publicSettings(await loadSettings()) });
}
