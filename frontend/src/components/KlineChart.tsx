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
  const seriesRef = useRef<ISeriesApi<SeriesType>[]>([]);
  const barsRef = useRef<KlineBar[]>([]);
  const [hoverBar, setHoverBar] = useState<KlineBar | null>(null);

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
        color: (bar.close || 0) >= (bar.open || 0) ? "rgba(214, 79, 69, 0.45)" : "rgba(21, 135, 111, 0.45)",
      }));
  }, [payload]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const chart = createChart(element, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#3d4957",
        fontFamily: "Inter, system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: "#e9edf2" },
        horzLines: { color: "#e9edf2" },
      },
      rightPriceScale: {
        borderColor: "#d8dee7",
      },
      timeScale: {
        borderColor: "#d8dee7",
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
    seriesRef.current.forEach((series) => {
      try {
        chart.removeSeries(series);
      } catch {
        // React StrictMode can replay effects during development; stale series may already be gone.
      }
    });
    seriesRef.current = [];
    const candle = chart.addCandlestickSeries({
      upColor: "#d64f45",
      downColor: "#15876f",
      borderUpColor: "#d64f45",
      borderDownColor: "#15876f",
      wickUpColor: "#d64f45",
      wickDownColor: "#15876f",
    });
    candle.setData(candleData);
    seriesRef.current.push(candle);

    if (payload?.period === "day" && autoDrawing) {
      autoDrawing.levels.forEach((level, index) => {
        candle.createPriceLine({
          price: level.price,
          color: colorForLevel(level, lineColors, index),
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `${level.label} ${level.price}`,
        });
      });

      autoDrawing.trendSegments.forEach((segment, index) => {
        const trend = chart.addLineSeries({
          color: segment.direction === "up" ? ["#d64f45", "#f59e0b"][index % 2] : ["#15876f", "#2563eb"][index % 2],
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          lineStyle: segment.direction === "up" ? LineStyle.Solid : LineStyle.Dotted,
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
      ma5: "#1f6feb",
      ma10: "#a35d00",
      ma20: "#6f42c1",
      ma60: "#0f766e",
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
  }, [autoDrawing, candleData, lineColors, payload, volumeData]);

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
  }

  function scroll(direction: -1 | 1) {
    const chart = chartRef.current;
    const range = chart?.timeScale().getVisibleLogicalRange();
    if (!chart || !range) return;
    const shift = (range.to - range.from) * 0.18 * direction;
    setLogicalRange(range.from + shift, range.to + shift);
  }

  const latest = hoverBar || payload?.bars[payload.bars.length - 1];
  const macd = payload?.indicators?.macd;
  const rsi = payload?.indicators?.rsi;
  const lastIndex = Math.max((payload?.bars.length || 1) - 1, 0);

  return (
    <div className="chart-panel">
      <div className="chart-header">
        <h3>K 线</h3>
        <div className="chart-header-actions">
          <span>{payload?.period || "-"} · {latest?.time || "-"}</span>
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
      <div className="kline-canvas" ref={containerRef} />
      <div className="indicator-strip">
        <span>MACD {macd?.hist?.[lastIndex]?.toFixed?.(3) ?? "-"}</span>
        <span>DIF {macd?.dif?.[lastIndex]?.toFixed?.(3) ?? "-"}</span>
        <span>DEA {macd?.dea?.[lastIndex]?.toFixed?.(3) ?? "-"}</span>
        <span>RSI6 {rsi?.rsi6?.[lastIndex]?.toFixed?.(2) ?? "-"}</span>
        <span>RSI12 {rsi?.rsi12?.[lastIndex]?.toFixed?.(2) ?? "-"}</span>
      </div>
    </div>
  );
}
