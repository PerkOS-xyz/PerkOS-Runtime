/**
 * The Desks a person can run, and the market of the one they are in.
 *
 * What arrives here crosses a repo boundary: the desk that answered lives
 * somewhere else and ships on its own schedule. So the answer is parsed
 * against the contract before anyone draws it, and a desk that answers
 * something the contract does not allow is reported as a failing desk rather
 * than painted on screen.
 */

import { DeskMarketSchema, DeskSeriesSchema, type DeskMarket, type DeskSeries } from "@perkos/desk-contract";

import { PerkosApiError, type PerkosClient } from "./client.js";

/** A desk as the catalogue lists it. Everything past the id is for the screen. */
export interface DeskSummary {
  id: string;
  name: string;
  description: string;
  module?: string;
  chain?: string;
  tagline?: string;
  screens?: string[];
}

const parseOrFail = <T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }, value: unknown, what: string): T => {
  const parsed = schema.safeParse(value);
  if (!parsed.success || parsed.data === undefined) {
    throw new PerkosApiError(`The desk answered a ${what} this version cannot read`, 502, "DESK_CONTRACT");
  }
  return parsed.data;
};

export class Desks {
  constructor(private readonly client: PerkosClient) {}

  /** Every desk published by PerkOS, for the dashboard and for Sparky. */
  async catalogue(): Promise<DeskSummary[]> {
    const body = await this.client.request<{ templates?: DeskSummary[] }>("/project-templates");
    return body.templates ?? [];
  }

  /** What this desk can trade, priced. */
  async market(module: string): Promise<DeskMarket> {
    const body = await this.client.request<Record<string, unknown>>(`/desks/${encodeURIComponent(module)}/market`);
    const { ok: _ok, module: _module, ...market } = body;
    return parseOrFail<DeskMarket>(DeskMarketSchema, market, "market");
  }

  /** Price history per ticker, for the facts a desk turn cites. */
  async series(module: string, tickers: string[]): Promise<DeskSeries[]> {
    const wanted = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))];
    if (!wanted.length) return [];
    const body = await this.client.request<{ series?: unknown[] }>(`/desks/${encodeURIComponent(module)}/series`, {
      query: { tickers: wanted.join(",") },
    });
    return (body.series ?? []).map((s) => parseOrFail<DeskSeries>(DeskSeriesSchema, s, "series"));
  }
}
