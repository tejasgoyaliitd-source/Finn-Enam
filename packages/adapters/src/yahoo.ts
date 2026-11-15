import YahooFinance from "yahoo-finance2";
import type { ChartClient } from "@finn/core";

/** Daily bars from yahoo-finance2's chart module. Symbols arrive already suffixed (.NS). */
export function yahooChartClient(): ChartClient {
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  return {
    async daily(symbol, from, to) {
      const r = await yf.chart(symbol, { period1: from, period2: to, interval: "1d" });
      return r.quotes.map((q) => ({ date: q.date, close: q.close ?? null, volume: q.volume ?? null }));
    },
  };
}
