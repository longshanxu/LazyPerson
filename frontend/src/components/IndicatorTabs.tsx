import * as echarts from "echarts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KlinePayload, MoneyFlowPayload } from "../types";

type TabKey = "macd" | "rsi" | "flow";

type Props = {
  kline: KlinePayload | null;
  moneyFlow: MoneyFlowPayload | null;
};

export function IndicatorTabs({ kline, moneyFlow }: Props) {
  const [active, setActive] = useState<TabKey>("macd");
  const ref = useRef<HTMLDivElement | null>(null);

  const option = useMemo(() => {
    const bars = kline?.bars || [];
    const times = bars.map((bar) => bar.time);
    if (active === "rsi") {
      const rsi = kline?.indicators?.rsi || {};
      return {
        color: ["#1f6feb", "#a35d00", "#6f42c1"],
        legend: { top: 0, right: 8, textStyle: { color: "#667382" } },
        tooltip: { trigger: "axis" },
        grid: { left: 46, right: 18, top: 34, bottom: 28 },
        xAxis: { type: "category", data: times, axisLabel: { color: "#667382", fontSize: 10 } },
        yAxis: { type: "value", min: 0, max: 100, splitLine: { lineStyle: { color: "#edf1f5" } } },
        series: ["rsi6", "rsi12", "rsi24"].map((name) => ({
          name: name.toUpperCase(),
          type: "line",
          showSymbol: false,
          data: rsi[name] || [],
        })),
      };
    }
    if (active === "flow") {
      const items = (moneyFlow?.items || []).slice(-120);
      return {
        color: ["#1f6feb", "#d64f45", "#15876f"],
        legend: { top: 0, right: 8, textStyle: { color: "#667382" } },
        tooltip: { trigger: "axis" },
        grid: { left: 46, right: 18, top: 34, bottom: 28 },
        xAxis: { type: "category", data: items.map((item) => item.time), axisLabel: { color: "#667382", fontSize: 10 } },
        yAxis: { type: "value", axisLabel: { formatter: "{value}亿" }, splitLine: { lineStyle: { color: "#edf1f5" } } },
        series: [
          {
            name: "主力",
            type: "bar",
            data: items.map((item) => yuanToYi(item.main_net_inflow)),
          },
          {
            name: "超大单",
            type: "line",
            showSymbol: false,
            data: items.map((item) => yuanToYi(item.super_large_net_inflow)),
          },
          {
            name: "大单",
            type: "line",
            showSymbol: false,
            data: items.map((item) => yuanToYi(item.large_net_inflow)),
          },
        ],
      };
    }
    const macd = kline?.indicators?.macd || {};
    return {
      color: ["#1f6feb", "#a35d00", "#d64f45"],
      legend: { top: 0, right: 8, textStyle: { color: "#667382" } },
      tooltip: { trigger: "axis" },
      grid: { left: 46, right: 18, top: 34, bottom: 28 },
      xAxis: { type: "category", data: times, axisLabel: { color: "#667382", fontSize: 10 } },
      yAxis: { type: "value", splitLine: { lineStyle: { color: "#edf1f5" } } },
      series: [
        { name: "DIF", type: "line", showSymbol: false, data: macd.dif || [] },
        { name: "DEA", type: "line", showSymbol: false, data: macd.dea || [] },
        { name: "MACD", type: "bar", data: macd.hist || [] },
      ],
    };
  }, [active, kline, moneyFlow]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const chart = echarts.init(element);
    chart.setOption(option);
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chart.dispose();
    };
  }, [option]);

  return (
    <section className="indicator-panel">
      <div className="indicator-tabs">
        <button className={active === "macd" ? "active" : ""} onClick={() => setActive("macd")}>MACD</button>
        <button className={active === "rsi" ? "active" : ""} onClick={() => setActive("rsi")}>RSI</button>
        <button className={active === "flow" ? "active" : ""} onClick={() => setActive("flow")}>资金流</button>
      </div>
      <div className="indicator-canvas" ref={ref} />
    </section>
  );
}

function yuanToYi(value: number | null | undefined) {
  if (value === null || value === undefined) return 0;
  return Number((value / 100000000).toFixed(3));
}

