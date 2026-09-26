/**
 * What this app remembers about launches, in <home>/launches.json (0600):
 * each launch it sent, per signed-in wallet, and when it asked Bankr for a
 * simulation or a launch, per Bankr wallet. Public facts only: addresses,
 * names and times.
 *
 * Bankr's public list keeps only the 50 most recent launches of every chain,
 * so a launch made here drops out of it within hours; this keeps it for the
 * person's list, and keeps the count of today's attempts that Bankr's limits
 * are about.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { homeDir } from "./home";

export interface LoggedLaunch {
  tokenAddress: string;
  poolId: string | null;
  txHash: string | null;
  name: string;
  symbol: string;
  pairAddress: string | null;
  pairedSymbol: string;
  feeRecipient: string;
  deployer: string;
  deployedAt: string;
}

interface LogFile {
  v: 1;
  launches: Record<string, LoggedLaunch[]>;
  simulations: Record<string, number[]>;
  attempts: Record<string, number[]>;
}

const DAY_MS = 24 * 60 * 60_000;
/** Launches kept per wallet. */
const KEEP = 100;

const empty = (): LogFile => ({ v: 1, launches: {}, simulations: {}, attempts: {} });

/** The order writes run in. On globalThis, so every route writes through the same one. */
interface Lane {
  queue: Promise<unknown>;
}
const LANE = Symbol.for("perkos.runtime.launchLog");
function sharedLane(): Lane {
  const g = globalThis as unknown as Record<symbol, Lane | undefined>;
  let lane = g[LANE];
  if (!lane) {
    lane = { queue: Promise.resolve() };
    g[LANE] = lane;
  }
  return lane;
}

export class LaunchLog {
  constructor(
    private readonly dir: () => string = homeDir,
    private readonly now: () => number = Date.now,
    private readonly lane: Lane = sharedLane(),
  ) {}

  private file() {
    return join(this.dir(), "launches.json");
  }

  private async read(): Promise<LogFile> {
    try {
      const f = JSON.parse(await readFile(this.file(), "utf8")) as Partial<LogFile>;
      if (f?.v !== 1) return empty();
      return { v: 1, launches: f.launches ?? {}, simulations: f.simulations ?? {}, attempts: f.attempts ?? {} };
    } catch {
      return empty();
    }
  }

  /** Through a temporary file, so a crash never leaves half a log. */
  private async write(f: LogFile): Promise<void> {
    const file = this.file();
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(`${file}.tmp`, JSON.stringify(f), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
  }

  /** One change at a time, so two routes never write over each other. */
  private change<T>(task: (f: LogFile) => T): Promise<T> {
    const run = this.lane.queue.then(async () => {
      const f = await this.read();
      const out = task(f);
      await this.write(f);
      return out;
    });
    this.lane.queue = run.catch(() => undefined);
    return run;
  }

  private within(times: number[] | undefined): number[] {
    const cutoff = this.now() - DAY_MS;
    return (times ?? []).filter((t) => typeof t === "number" && t > cutoff);
  }

  /** The launches this app sent for a wallet, newest first. */
  async launches(wallet: string): Promise<LoggedLaunch[]> {
    await this.lane.queue;
    return [...((await this.read()).launches[wallet.toLowerCase()] ?? [])].sort((a, b) => b.deployedAt.localeCompare(a.deployedAt));
  }

  async record(wallet: string, launch: LoggedLaunch): Promise<void> {
    const w = wallet.toLowerCase();
    await this.change((f) => {
      const kept = (f.launches[w] ?? []).filter((l) => l.tokenAddress !== launch.tokenAddress);
      f.launches[w] = [launch, ...kept].slice(0, KEEP);
    });
  }

  /** Simulations asked for with a Bankr wallet in the last 24 hours. */
  async simulations(bankrWallet: string): Promise<number> {
    await this.lane.queue;
    return this.within((await this.read()).simulations[bankrWallet.toLowerCase()]).length;
  }

  /** Counts one more simulation, and returns how many the last 24 hours now hold. */
  async countSimulation(bankrWallet: string): Promise<number> {
    const w = bankrWallet.toLowerCase();
    return this.change((f) => {
      const times = [...this.within(f.simulations[w]), this.now()];
      f.simulations[w] = times;
      return times.length;
    });
  }

  /** Launches this app sent from a Bankr wallet in the last 24 hours that may have reached the chain. */
  async attempts(bankrWallet: string): Promise<number> {
    await this.lane.queue;
    return this.within((await this.read()).attempts[bankrWallet.toLowerCase()]).length;
  }

  async countAttempt(bankrWallet: string): Promise<void> {
    const w = bankrWallet.toLowerCase();
    await this.change((f) => {
      f.attempts[w] = [...this.within(f.attempts[w]), this.now()];
    });
  }
}

export const launchLog = new LaunchLog();
