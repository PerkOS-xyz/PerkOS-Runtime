import { bankrMe } from "../../lib/bankr";
import { BANKR_KEY, BANKR_PARTNER_KEY, bankrKey } from "../../lib/bankrKey";
import { guard } from "../../lib/guard";

// GET -> { saved, persistent }. `persistent` is false when the key lasts this session only.
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  return Response.json({ saved: (await bankrKey.load()) !== null, persistent: bankrKey.persistent() });
}

// POST { apiKey } -> { saved: true, persistent, wallet }. The key is checked
// against Bankr before it is saved; `wallet` is the Bankr wallet it launches
// from. The key itself never comes back.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { apiKey?: unknown };
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (BANKR_PARTNER_KEY.test(apiKey)) {
    return Response.json(
      { error: "partner_key", message: "That is a Bankr partner key, which launches on Base only. Use a user key (bk_usr_…)." },
      { status: 400 },
    );
  }
  if (!BANKR_KEY.test(apiKey)) {
    return Response.json({ error: "format", message: "That does not look like a Bankr API key (bk_usr_…)." }, { status: 400 });
  }
  const me = await bankrMe(apiKey);
  if (!me.ok) {
    if (me.status === 401) return Response.json({ error: "rejected", message: "Bankr rejected this key." }, { status: 400 });
    if (me.status === 403) return Response.json({ error: "rejected", message: `Bankr refused this key: ${me.message}` }, { status: 400 });
    return Response.json({ error: "unreachable", message: "Could not reach Bankr. Try again." }, { status: 502 });
  }
  await bankrKey.save(apiKey);
  return Response.json({ saved: true, persistent: bankrKey.persistent(), wallet: me.data.address });
}

// DELETE -> { saved: false }
export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  await bankrKey.clear();
  return Response.json({ saved: false });
}
