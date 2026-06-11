import {
  createChart,
  ColorType,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KlineBar, KlinePayload } from "../types";
import type { AutoDrawing, AutoLineColorMap } from "../utils/autoDrawing";
import { colorForLevel, trendLabel } from "../utils/autoDrawing";
import { formatNumber, formatPercent } from "../utils/format";

type Props = {
  payload: KlinePayload | null;
  autoDrawing: AutoDrawing | null;
  lineColors: AutoLineColorMap;
};

function chartTime(value: string) {
  if (value.includes(" ")) {
    return Math.floor(new Date(value.replace(" ", "T")).getTime() / 1000);
  }
  return value;
}

export function KlineChart({ payload, autoDrawing, lineColors }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const seriesRef = useRef<ISeriesApi<SeriesType>[]>([]);
  const barsRef = useRef<KlineBar[]>([]);
  const [hoverBar, setHoverBar] = useState<KlineBar | null>(null);
  const [levelLabels, setLevelLabels] = useState<Array<{
    label: string;
    color: string;
    textColor: string;
    top: number;
    highlight: boolean;
  }>>([]);

  const candleData = useMemo(() => {
    return (payload?.bars || [])
      .filter((bar) => bar.open !== null && bar.high !== null && bar.low !== null && bar.close !== null)
      .map((bar) => ({
        time: chartTime(bar.time) as never,
        open: Number(bar.open),
        high: Number(bar.high),
        low: Number(bar.low),
        close: Number(bar.close),
      }));
  }, [payload]);

  useEffect(() => {
    barsRef.current = payload?.bars || [];
    setHoverBar(null);
  }, [payload]);

  const volumeData = useMemo(() => {
    return (payload?.bars || [])
      .filter((bar) => bar.volume !== null)
      .map((bar) => ({
        time: chartTime(bar.time) as never,
        value: Number(bar.volume),
        color: (bar.close || 0) >= (bar.open || 0) ? "rgba(242, 77, 77, 0.46)" : "rgba(0, 168, 132, 0.46)",
      }));
  }, [payload]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const chart = createChart(element, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#070b12" },
        textColor: "#8f9bb0",
        fontFamily: "Inter, system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: "#172033" },
        horzLines: { color: "#172033" },
      },
      rightPriceScale: {
        borderColor: "#28354a",
      },
      timeScale: {
        borderColor: "#28354a",
        timeVisible: true,
      },
      handleScroll: {
        mouseWheel: false,
        pressedMouseMove: false,
        horzTouchDrag: false,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: false,
        mouseWheel: false,
        pinch: false,
      },
      crosshair: {
        mode: 1,
      },
    });
    chart.subscribeCrosshairMove((param) => {
      const time = String(param.time || "");
      const matched = barsRef.current.find((bar) => String(chartTime(bar.time)) === time || bar.time === time);
      setHoverBar(matched || null);
    });
    chartRef.current = chart;
    seriesRef.current = [];
    return () => {
      seriesRef.current = [];
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    candleSeriesRef.current = null;
    seriesRef.current.forEach((series) => {
      try {
        chart.removeSeries(series);
      } catch {
        // React StrictMode can replay effects during development; stale series may already be gone.
      }
    });
    seriesRef.current = [];
    const candle = chart.addCandlestickSeries({
      upColor: "#f24d4d",
      downColor: "#00a884",
      borderUpColor: "#f24d4d",
      borderDownColor: "#00a884",
      wickUpColor: "#f24d4d",
      wickDownColor: "#00a884",
    });
    candle.setData(candleData);
    candleSeriesRef.current = candle;
    seriesRef.current.push(candle);

    if (payload?.period === "day" && autoDrawing) {
      autoDrawing.levels.forEach((level, index) => {
        const highlight = isHighlightLevel(level.label);
        candle.createPriceLine({
          price: level.price,
          color: lineColor(level.label, colorForLevel(level, lineColors, index)),
          lineWidth: highlight ? 3 : 1,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: false,
          title: "",
        });
      });

      autoDrawing.trendSegments.forEach((segment, index) => {
        const trend = chart.addLineSeries({
          color: segment.direction === "up" ? "#f24d4d" : "#00a884",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          lineStyle: LineStyle.Solid,
        });
        trend.setData([
          { time: chartTime(segment.start.time) as never, value: segment.start.price },
          { time: chartTime(segment.end.time) as never, value: segment.end.price },
        ]);
        seriesRef.current.push(trend);
      });
    }

    const volume = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volume.priceScale().applyOptions({
      scaleMargins: {
        top: 0.78,
        bottom: 0,
      },
    });
    volume.setData(volumeData);
    seriesRef.current.push(volume);

    const ma = payload?.indicators?.ma || {};
    const colors: Record<string, string> = {
      ma5: "#f2c94c",
      ma10: "#38bdf8",
      ma20: "#c084fc",
      ma60: "#f97316",
    };
    Object.entries(ma).forEach(([name, values]) => {
      const series = chart.addLineSeries({
        color: colors[name] || "#555",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      seriesRef.current.push(series);
      series.setData(
        values
          .map((value, index) => ({
            time: chartTime(payload?.bars[index]?.time || "") as never,
            value,
          }))
          .filter((item) => item.time && item.value !== null) as never,
      );
    });

    chart.timeScale().fitContent();
    window.setTimeout(updateLevelLabelPositions, 60);
  }, [autoDrawing, candleData, lineColors, payload, volumeData]);

  useEffect(() => {
    const resize = () => updateLevelLabelPositions();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [autoDrawing, lineColors]);

  function updateLevelLabelPositions() {
    if (!autoDrawing || !candleSeriesRef.current) {
      setLevelLabels([]);
      return;
    }
    const rows = autoDrawing.levels
      .map((level, index) => {
        const coordinate = candleSeriesRef.current?.priceToCoordinate(level.price);
        if (coordinate === null || coordinate === undefined) return null;
        return {
          label: level.label,
          color: lineColor(level.label, colorForLevel(level, lineColors, index)),
          textColor: labelTextColor(level.label),
          top: Number(coordinate),
          highlight: isHighlightLevel(level.label),
        };
      })
      .filter(Boolean) as Array<{ label: string; color: string; textColor: string; top: number; highlight: boolean }>;
    setLevelLabels(rows);
  }

  function setLogicalRange(nextFrom: number, nextTo: number) {
    const chart = chartRef.current;
    if (!chart) return;
    chart.timeScale().setVisibleLogicalRange({ from: nextFrom, to: nextTo });
  }

  function zoom(factor: number) {
    const chart = chartRef.current;
    const range = chart?.timeScale().getVisibleLogicalRange();
    if (!chart || !range) return;
    const center = (range.from + range.to) / 2;
    const half = ((range.to - range.from) * factor) / 2;
    setLogicalRange(center - half, center + half);
    window.setTimeout(updateLevelLabelPositions, 30);
  }

  function scroll(direction: -1 | 1) {
    const chart = chartRef.current;
    const range = chart?.timeScale().getVisibleLogicalRange();
    if (!chart || !range) return;
    const shift = (range.to - range.from) * 0.18 * direction;
    setLogicalRange(range.from + shift, range.to + shift);
    window.setTimeout(updateLevelLabelPositions, 30);
  }

  const latest = hoverBar || payload?.bars[payload.bars.length - 1];
  const macd = payload?.indicators?.macd;
  const lastIndex = Math.max((payload?.bars.length || 1) - 1, 0);

  return (
    <div className="chart-panel">
      <div className="chart-header">
        <h3>K 线</h3>
        <div className="chart-header-actions">
          <span>{payload?.period === "day" ? "近90自然日交易K" : payload?.period || "-"} · {latest?.time || "-"}</span>
          <button onClick={() => zoom(0.72)} title="放大">+</button>
          <button onClick={() => zoom(1.28)} title="缩小">-</button>
          <button onClick={() => scroll(-1)} title="左移">←</button>
          <button onClick={() => scroll(1)} title="右移">→</button>
          <button onClick={() => chartRef.current?.timeScale().fitContent()} title="全览">全览</button>
        </div>
      </div>
      {payload?.period === "day" && autoDrawing && (
        <div className={`auto-drawing-strip ${autoDrawing.direction}`}>
          <strong>{trendLabel(autoDrawing.direction)}</strong>
          <span>{autoDrawing.base.label} {autoDrawing.base.time} / {formatNumber(autoDrawing.base.price)}</span>
          <span>{autoDrawing.target.label} {autoDrawing.target.time} / {formatNumber(autoDrawing.target.price)}</span>
          <span>最近线位 {autoDrawing.nearestLevel?.label || "-"} / {formatNumber(autoDrawing.nearestLevel?.price)}</span>
        </div>
      )}
      <div className="ohlc-strip">
        <span>开 {formatNumber(latest?.open)}</span>
        <span>高 {formatNumber(latest?.high)}</span>
        <span>低 {formatNumber(latest?.low)}</span>
        <span>收 {formatNumber(latest?.close)}</span>
        <span>幅 {formatPercent(latest?.pct_chg)}</span>
        <span>量 {formatNumber(latest?.volume)}</span>
      </div>
      <div className="chart-canvas-wrap">
        <div className="kline-canvas" ref={containerRef} />
        {levelLabels.length > 0 && (
          <div className="level-label-overlay" aria-hidden="true">
            {levelLabels.map((item) => (
              <div
                className={`level-label-row ${item.highlight ? "highlight" : ""}`}
                key={item.label}
                style={{ top: item.top, backgroundColor: item.color, color: item.textColor }}
              >
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="indicator-strip">
        <span>MACD {macd?.hist?.[lastIndex]?.toFixed?.(3) ?? "-"}</span>
        <span>DIF {macd?.dif?.[lastIndex]?.toFixed?.(3) ?? "-"}</span>
        <span>DEA {macd?.dea?.[lastIndex]?.toFixed?.(3) ?? "-"}</span>
        <span>LON {payload?.indicators?.lon?.lon?.[lastIndex]?.toFixed?.(3) ?? "-"}</span>
        <span>LONMA {payload?.indicators?.lon?.lonma?.[lastIndex]?.toFixed?.(3) ?? "-"}</span>
      </div>
    </div>
  );
}

function isHighlightLevel(label: string) {
  return label === "+20%" || label === "+50%" || label === "+80%";
}

function lineColor(label: string, fallback: string) {
  if (label === "+20%") return "#f24d4d";
  if (label === "+50%") return "#1f6feb";
  if (label === "+80%") return "#ffffff";
  return fallback;
}

function labelTextColor(label: string) {
  if (label === "+20%" || label === "+50%") return "#ffffff";
  return "#07111f";
}
