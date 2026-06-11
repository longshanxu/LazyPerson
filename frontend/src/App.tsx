import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { IndicatorTabs } from "./components/IndicatorTabs";
import { KlineChart } from "./components/KlineChart";
import { StatusBar } from "./components/StatusBar";
import { StockSummary } from "./components/StockSummary";
import { WatchlistPanel } from "./components/WatchlistPanel";
import type { DataQuality, KlinePayload, MoneyFlowPayload, Quote, SymbolItem, WatchlistItem } from "./types";
import { computeAutoDrawing, loadLineColors, saveLineColors, type AutoLineColorMap } from "./utils/autoDrawing";
import { normalizeError, qualityText } from "./utils/format";

const periods = ["day", "1m", "5m", "15m", "30m", "60m"];
type SortKey = "custom" | "pct" | "amount" | "price";

export function App() {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [selected, setSelected] = useState("002138");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SymbolItem[]>([]);
  const [period, setPeriod] = useState("day");
  const [sortKey, setSortKey] = useState<SortKey>("custom");
  const [kline, setKline] = useState<KlinePayload | null>(null);
  const [moneyFlow, setMoneyFlow] = useState<MoneyFlowPayload | null>(null);
  const [quoteQuality, setQuoteQuality] = useState<DataQuality | null>(null);
  const [klineQuality, setKlineQuality] = useState<DataQuality | null>(null);
  const [backendStatus, setBackendStatus] = useState("连接中");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [lineColors, setLineColors] = useState<AutoLineColorMap>(() => loadLineColors());

  const symbols = useMemo(() => watchlist.map((item) => item.symbol), [watchlist]);
  const selectedQuote = quotes.find((quote) => quote.symbol === selected);
  const latestBar = kline?.bars[kline.bars.length - 1];
  const autoDrawing = useMemo(() => {
    if (kline?.period !== "day") return null;
    return computeAutoDrawing(kline?.bars || [], 90);
  }, [kline]);

  const loadWatchlist = useCallback(async () => {
    const response = await api.listWatchlist();
    setWatchlist(response.data);
    setSelected((current) => current || response.data[0]?.symbol || "002138");
  }, []);

  const loadQuotes = useCallback(async (refresh = false) => {
    const target = symbols.length ? symbols : [selected];
    if (!target.length) return;
    const response = await api.realtimeQuotes(target, refresh);
    setQuotes(response.data);
    setQuoteQuality(response.quality || null);
    if (response.quality?.fallback || response.quality?.stale) {
      setNotice(response.quality.message || qualityText(response.quality));
    }
  }, [selected, symbols]);

  const loadDetail = useCallback(async (refresh = false) => {
    if (!selected) return;
    const [klineResponse, flowResponse] = await Promise.allSettled([
      api.kline(selected, period, refresh, period === "day" ? 90 : 1000),
      api.moneyFlow(selected, refresh),
    ]);
    if (klineResponse.status === "fulfilled") {
      setKline(klineResponse.value.data);
      setKlineQuality(klineResponse.value.quality || null);
    } else {
      setNotice(normalizeError(klineResponse.reason));
    }
    if (flowResponse.status === "fulfilled") {
      setMoneyFlow(flowResponse.value.data);
    }
  }, [period, selected]);

  useEffect(() => {
    api.health()
      .then((response) => setBackendStatus(`后端 ${response.data.version}`))
      .catch(() => setBackendStatus("后端未连接"));
    loadWatchlist().catch((exc) => setNotice(normalizeError(exc)));
  }, [loadWatchlist]);

  useEffect(() => {
    loadQuotes().catch((exc) => setNotice(normalizeError(exc)));
  }, [loadQuotes]);

  useEffect(() => {
    loadDetail().catch((exc) => setNotice(normalizeError(exc)));
  }, [loadDetail]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      api.searchSymbols(query.trim())
        .then((response) => setResults(response.data))
        .catch((exc) => setNotice(normalizeError(exc)));
    }, 260);
    return () => window.clearTimeout(timer);
  }, [query]);

  async function addSymbol(symbol: string) {
    setLoading(true);
    try {
      await api.addWatchlist(symbol);
      setSelected(symbol);
      setQuery("");
      setResults([]);
      await loadWatchlist();
    } catch (exc) {
      setNotice(normalizeError(exc));
    } finally {
      setLoading(false);
    }
  }

  async function removeSymbol(symbol: string) {
    setLoading(true);
    try {
      await api.removeWatchlist(symbol);
      await loadWatchlist();
      if (selected === symbol) {
        const next = watchlist.find((item) => item.symbol !== symbol);
        setSelected(next?.symbol || "002138");
      }
    } catch (exc) {
      setNotice(normalizeError(exc));
    } finally {
      setLoading(false);
    }
  }

  async function refreshAll() {
    setLoading(true);
    setNotice("");
    try {
      await Promise.all([loadQuotes(true), loadDetail(true)]);
    } catch (exc) {
      setNotice(normalizeError(exc));
    } finally {
      setLoading(false);
    }
  }

  function updateLineColor(label: string, color: string) {
    const next = { ...lineColors, [label]: color };
    setLineColors(next);
    saveLineColors(next);
  }

  return (
    <main className="app-shell v2">
      <StatusBar
        backendStatus={backendStatus}
        quoteQuality={quoteQuality}
        klineQuality={klineQuality}
        loading={loading}
        onRefresh={refreshAll}
      />

      {notice && (
        <div className="notice v2">
          <span>{notice}</span>
          <button onClick={() => setNotice("")}>关闭</button>
        </div>
      )}

      <section className="terminal-layout">
        <WatchlistPanel
          query={query}
          results={results}
          watchlist={watchlist}
          quotes={quotes}
          selected={selected}
          sortKey={sortKey}
          onQueryChange={setQuery}
          onSortChange={setSortKey}
          onAdd={addSymbol}
          onRemove={removeSymbol}
          onSelect={setSelected}
        />

        <section className="chart-workbench">
          <div className="workbench-head">
            <div>
              <h2>{selectedQuote?.name || selected}</h2>
              <span>{selected} · {qualityText(klineQuality)}</span>
            </div>
            <div className="period-switch">
              {periods.map((item) => (
                <button className={period === item ? "active" : ""} key={item} onClick={() => setPeriod(item)}>
                  {item === "day" ? "日 K" : item}
                </button>
              ))}
            </div>
          </div>

          <KlineChart payload={kline} autoDrawing={autoDrawing} lineColors={lineColors} />
          <IndicatorTabs kline={kline} moneyFlow={moneyFlow} />
        </section>

        <StockSummary
          symbol={selected}
          quote={selectedQuote}
          latestBar={latestBar}
          quoteQuality={quoteQuality}
          klineQuality={klineQuality}
          autoDrawing={autoDrawing}
          lineColors={lineColors}
          onLineColorChange={updateLineColor}
          onRefresh={refreshAll}
          onRemove={() => removeSymbol(selected)}
        />
      </section>
    </main>
  );
}
