"use client";

import type { DeskSeries } from "@perkos/desk-contract";
import { useEffect, useState } from "react";

/** The price history of one ticker on a desk, while it is selected. */
export function useSeries(module: string, ticker: string | null): { series: DeskSeries | null; loading: boolean } {
  const [series, setSeries] = useState<DeskSeries | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSeries(null);
    if (!ticker) return;
    let live = true;
    setLoading(true);
    fetch(`/api/desks/series?module=${encodeURIComponent(module)}&tickers=${encodeURIComponent(ticker)}`)
      .then((res) => (res.ok ? (res.json() as Promise<{ series?: DeskSeries[] }>) : { series: [] }))
      .then((body) => {
        if (live) setSeries(body.series?.find((s) => s.ticker.toUpperCase() === ticker.toUpperCase()) ?? null);
      })
      .catch(() => undefined)
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [module, ticker]);

  return { series, loading };
}
