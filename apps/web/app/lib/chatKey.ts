import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { verifyMessage } from "viem";

// Llave del historial de chat. La raiz es una firma de la wallet sobre un
// mensaje fijo (personal_sign, determinista): key = SHA-256(dominio | firma).
// Con esa llave los hilos se guardan en disco con AES-256-GCM; sin ella son
// ilegibles. Para no pedir una firma (un aviso en el celular con WalletConnect)
// en cada arranque, la llave derivada se guarda en el Llavero de macOS; en otra
// maquina se recupera firmando el mismo mensaje. No mueve fondos ni autoriza nada.
const SERVICE = "xyz.perkos.chat-key";
const mem = new Map<string, Buffer>();

export const chatKeyMessage = (wallet: string) =>
  `PerkOS chat history key\nWallet: ${wallet.toLowerCase()}\n\nThis signature unlocks your encrypted chat history on this computer. It moves no funds and approves nothing.`;

export class KeyRequired extends Error { constructor() { super("key_required"); } }

// `security -i` lee los comandos por stdin: el secreto no pasa por argv (visible en ps).
function security(lines: string[], timeoutMs = 6000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    if (process.platform !== "darwin") return resolve({ code: 1, out: "" });
    const p = spawn("/usr/bin/security", ["-i"], { stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    const t = setTimeout(() => { p.kill(); resolve({ code: 1, out }); }, timeoutMs);
    p.stdout.on("data", (d) => { out += String(d); });
    p.on("close", (code) => { clearTimeout(t); resolve({ code: code ?? 1, out }); });
    p.on("error", () => { clearTimeout(t); resolve({ code: 1, out: "" }); });
    p.stdin.end(lines.join("\n") + "\n");
  });
}

export async function chatKey(wallet: string): Promise<Buffer | null> {
  const w = wallet.toLowerCase();
  const hit = mem.get(w); if (hit) return hit;
  const r = await security([`find-generic-password -a ${w} -s ${SERVICE} -w`]);
  const hex = r.out.trim().split(/\s+/).find((x) => /^[0-9a-f]{64}$/.test(x));
  if (!hex) return null;
  const key = Buffer.from(hex, "hex");
  mem.set(w, key);
  return key;
}

/** Verifica que la firma es de la wallet sobre el mensaje fijo, deriva la llave y la guarda (memoria + Llavero). */
export async function unlockWithSignature(wallet: string, signature: string): Promise<boolean> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet) || !/^0x[0-9a-fA-F]{130,}$/.test(signature)) return false;
  const ok = await verifyMessage({ address: wallet as `0x${string}`, message: chatKeyMessage(wallet), signature: signature as `0x${string}` }).catch(() => false);
  if (!ok) return false;
  const key = createHash("sha256").update(`perkos-chat-v1|${wallet.toLowerCase()}|${signature.toLowerCase()}`).digest();
  mem.set(wallet.toLowerCase(), key);
  await security([`add-generic-password -U -a ${wallet.toLowerCase()} -s ${SERVICE} -l "PerkOS chat history key" -w ${key.toString("hex")}`]);
  return true;
}

export type Sealed = { v: 1; alg: "AES-256-GCM"; iv: string; tag: string; ct: string };
export function seal(key: Buffer, value: unknown): Sealed {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return { v: 1, alg: "AES-256-GCM", iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), ct: ct.toString("base64") };
}
export function open<T>(key: Buffer, s: Sealed): T | null {
  try {
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(s.iv, "base64"));
    d.setAuthTag(Buffer.from(s.tag, "base64"));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(s.ct, "base64")), d.final()]).toString("utf8")) as T;
  } catch { return null; }
}
