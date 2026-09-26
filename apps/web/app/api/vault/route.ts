import { deriveVaultKey, vaultKeyMessage } from "@perkos/vault";

import { guard } from "../../lib/guard";
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

// POST { signature } -> { unlocked: true }
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const wallet = await sessionWallet();
  if (!wallet) return Response.json({ error: "signed_out" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { signature?: unknown };
  const signature = typeof body.signature === "string" ? body.signature : "";
  if (!(await verifyVaultSignature(wallet, signature))) {
    return Response.json({ error: "signature", message: "That signature is not from this wallet." }, { status: 400 });
  }
  await vaultKeys.save(wallet, deriveVaultKey(wallet, signature));
  return Response.json({ unlocked: true, persistent: vaultKeys.persistent() });
}

// DELETE -> { unlocked: false }. Forgets the key on this machine; the notes stay encrypted.
export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const wallet = await sessionWallet();
  if (wallet) await vaultKeys.forget(wallet);
  return Response.json({ unlocked: false });
}
