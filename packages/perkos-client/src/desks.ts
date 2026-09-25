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

/** A desk as listed by the catalogue. */
export interface DeskSummary {
  id: string;
  name: string;
  description: string;
  /** Desk module, used to open its market. Absent on older templates. */
  module?: string;
}

/** Template text, keyed by locale. */
type Localized = string | Record<string, string | undefined> | undefined;

const inLocale = (value: Localized, locale: string): string => {
  if (typeof value === "string") return value;
  if (!value) return "";
  return value[locale] ?? value.en ?? Object.values(value).find((v) => v) ?? "";
};

const parseOrFail = <T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }, value: unknown, what: string): T => {
  const parsed = schema.safeParse(value);
  if (!parsed.success || parsed.data === undefined) {
    throw new PerkosApiError(`The desk answered a ${what} this version cannot read`, 502, "DESK_CONTRACT");
  }
  return parsed.data;
};

export class Desks {
  constructor(private readonly client: PerkosClient) {}

  /** Published desks (templates of kind `fleet`), with text in `locale`. */
  async catalogue(locale = "en"): Promise<DeskSummary[]> {
    const body = await this.client.request<{ templates?: Array<Record<string, unknown>> }>("/project-templates");
    return (body.templates ?? []).flatMap((t) => {
      if (t.kind !== "fleet" || typeof t.id !== "string") return [];
      const summary: DeskSummary = {
        id: t.id,
        name: inLocale(t.name as Localized, locale) || t.id,
        description: inLocale(t.description as Localized, locale),
      };
      if (typeof t.module === "string" && t.module) summary.module = t.module;
      return [summary];
    });
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
