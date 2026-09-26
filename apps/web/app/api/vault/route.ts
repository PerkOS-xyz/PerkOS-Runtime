import { deriveVaultKey, NoteStore, vaultKeyMessage } from "@perkos/vault";

import { guard } from "../../lib/guard";
import { closeMemory, setMemoryAside, vaultRoot } from "../../lib/memory";
import { sessionWallet, vaultKeys, verifyVaultSignature } from "../../lib/vault";

// GET -> { unlocked, persistent, message? }. `message` is what the wallet signs to unlock.
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const wallet = await sessionWallet();
  if (!wallet) return Response.json({ error: "signed_out" }, { status: 401 });
  const unlocked = (await vaultKeys.load(wallet)) !== null;
  return Response.json({ unlocked, persistent: vaultKeys.persistent(), ...(unlocked ? {} : { message: vaultKeyMessage(wallet) }) });
}

// POST { signature, fresh? } -> { unlocked: true, persistent }
// 409 other_key: the key from this signature does not open the memory saved on this
// device (some wallets sign differently each time). `fresh: true` then sets that
// memory aside, still encrypted, and starts a new one.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const wallet = await sessionWallet();
  if (!wallet) return Response.json({ error: "signed_out" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { signature?: unknown; fresh?: unknown };
  const signature = typeof body.signature === "string" ? body.signature : "";
  if (!(await verifyVaultSignature(wallet, signature))) {
    return Response.json({ error: "signature", message: "That signature is not from this wallet." }, { status: 400 });
  }
  const key = deriveVaultKey(wallet, signature);
  if (!(await new NoteStore(vaultRoot(wallet), key).claim())) {
    if (body.fresh !== true) {
      return Response.json(
        { error: "other_key", message: "Your wallet signed differently than last time, so the memory saved on this device stays locked." },
        { status: 409 },
      );
    }
    await setMemoryAside(wallet);
    if (!(await new NoteStore(vaultRoot(wallet), key).claim())) {
      return Response.json({ error: "vault", message: "Could not start a new memory." }, { status: 500 });
    }
  }
  await vaultKeys.save(wallet, key);
  return Response.json({ unlocked: true, persistent: vaultKeys.persistent() });
}

// DELETE -> { unlocked: false }. Forgets the key on this machine; the notes stay encrypted.
export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const wallet = await sessionWallet();
  if (wallet) {
    closeMemory(wallet);
    await vaultKeys.forget(wallet);
  }
  return Response.json({ unlocked: false });
}
