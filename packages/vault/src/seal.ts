/**
 * AES-256-GCM for values at rest. `aad` binds a ciphertext to where it lives
 * (for example the note id), so a file moved to another path fails to open.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface Sealed {
  v: 1;
  alg: "AES-256-GCM";
  iv: string;
  tag: string;
  ct: string;
}

export function seal(key: Buffer, value: unknown, aad = ""): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { v: 1, alg: "AES-256-GCM", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ct: ct.toString("base64") };
}

/** The value, or null when the key, the path binding or the ciphertext is wrong. */
export function open<T>(key: Buffer, sealed: Sealed, aad = ""): T | null {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
    if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(sealed.ct, "base64")), decipher.final()]);
    return JSON.parse(plain.toString("utf8")) as T;
  } catch {
    return null;
  }
}

export const isSealed = (v: unknown): v is Sealed =>
  typeof v === "object" && v !== null && (v as Sealed).v === 1 && (v as Sealed).alg === "AES-256-GCM" && typeof (v as Sealed).ct === "string";
