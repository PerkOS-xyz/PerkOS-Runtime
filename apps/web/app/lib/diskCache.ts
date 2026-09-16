import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homePath } from "./home";

// Cache JSON en disco (~/.perkos-xyz/cache/<name>.json) compartida entre
// rutas: en Next cada ruta es su propio bundle con su propia copia de los
// modulos, asi que un Map en memoria no se comparte entre /api/market/warm y
// /api/market/news. El disco si, y ademas sobrevive reinicios. Solo datos
// publicos de mercado; nunca secretos.
const DIR = homePath("cache");

export class DiskCache<T> {
  private file: string;
  private mem: Record<string, { at: number; v: T }> | null = null;
  private loadedAt = 0;
  constructor(name: string, private ttlMs: number) { this.file = join(DIR, `${name}.json`); }
  private async load(): Promise<Record<string, { at: number; v: T }>> {
    // Releer del disco cada 2 s: otra ruta pudo escribir.
    if (this.mem && Date.now() - this.loadedAt < 2000) return this.mem;
    try { this.mem = JSON.parse(await readFile(this.file, "utf8")) as Record<string, { at: number; v: T }>; } catch { this.mem = this.mem ?? {}; }
    this.loadedAt = Date.now();
    return this.mem!;
  }
  async get(key: string): Promise<T | undefined> {
    const m = await this.load();
    const e = m[key];
    return e && Date.now() - e.at < this.ttlMs ? e.v : undefined;
  }
  async set(key: string, v: T): Promise<void> {
    const m = await this.load();
    m[key] = { at: Date.now(), v };
    for (const k of Object.keys(m)) if (Date.now() - m[k].at > this.ttlMs * 4) delete m[k];
    try { await mkdir(DIR, { recursive: true, mode: 0o700 }); await writeFile(this.file, JSON.stringify(m), { mode: 0o600 }); } catch { /* cache best effort */ }
  }
}
