import type { KlineBar } from "../types";

export type AutoTrendDirection = "up" | "down" | "flat";

export type AutoLineLevel = {
  label: string;
  percent: number;
  price: number;
};

export type AutoTrendSegment = {
  id: string;
  label: string;
  direction: "up" | "down";
  start: {
    time: string;
    price: number;
    index: number;
  };
  end: {
    time: string;
    price: number;
    index: number;
  };
};

export type AutoDrawing = {
  direction: AutoTrendDirection;
  windowSize: number;
  latest: KlineBar;
  recentHigh: {
    time: string;
    price: number;
    index: number;
  };
  recentLow: {
    time: string;
    price: number;
    index: number;
  };
  base: {
    time: string;
    price: number;
    label: string;
  };
  target: {
    time: string;
    price: number;
    label: string;
  };
  levels: AutoLineLevel[];
  trendSegments: AutoTrendSegment[];
  nearestLevel: AutoLineLevel | null;
  nearestDistancePct: number | null;
};

export type AutoLineColorMap = Record<string, string>;

const DEFAULT_WINDOW = 90;
const STORAGE_KEY = "lazy-person:auto-line-colors:v1";
const DEFAULT_COLORS: AutoLineColorMap = {
  "0%": "#64748b",
  "+10%": "#1f6feb",
  "+20%": "#d64f45",
  "+30%": "#6f42c1",
  "+40%": "#a35d00",
  "+50%": "#0f766e",
  "+60%": "#b91c1c",
  "+70%": "#2563eb",
  "+80%": "#7c3aed",
  "+90%": "#be123c",
  "+100%": "#0f766e",
};
const FALLBACK_COLORS = ["#64748b", "#1f6feb", "#d64f45", "#6f42c1", "#a35d00", "#0f766e", "#be123c"];

type Pivot = {
  time: string;
  price: number;
  index: number;
};

export function computeAutoDrawing(bars: KlineBar[], windowSize = DEFAULT_WINDOW): AutoDrawing | null {
  const valid = bars.filter((bar) => bar.high !== null && bar.low !== null && bar.close !== null);
  if (valid.length < 20) return null;

  const recent = valid.slice(-windowSize);
  let highIndex = 0;
  let lowIndex = 0;

  recent.forEach((bar, index) => {
    if (Number(bar.high) > Number(recent[highIndex].high)) highIndex = index;
    if (Number(bar.low) < Number(recent[lowIndex].low)) lowIndex = index;
  });

  const highBar = recent[highIndex];
  const lowBar = recent[lowIndex];
  const latest = recent[recent.length - 1];
  const highPrice = Number(highBar.high);
  const lowPrice = Number(lowBar.low);
  const close = Number(latest.close);
  const direction: AutoTrendDirection =
    highIndex > lowIndex ? "up" : lowIndex > highIndex ? "down" : "flat";
  const levels = buildLevels(lowPrice, highPrice);
  const nearestLevel = levels.reduce<AutoLineLevel | null>((nearest, level) => {
    if (!nearest) return level;
    return Math.abs(level.price - close) < Math.abs(nearest.price - close) ? level : nearest;
  }, null);

  return {
    direction,
    windowSize: recent.length,
    latest,
    recentHigh: {
      time: highBar.time,
      price: highPrice,
      index: highIndex,
    },
    recentLow: {
      time: lowBar.time,
      price: lowPrice,
      index: lowIndex,
    },
    base: {
      time: lowBar.time,
      price: lowPrice,
      label: "90日低点",
    },
    target: {
      time: highBar.time,
      price: highPrice,
      label: "90日高点",
    },
    levels,
    trendSegments: buildTrendSegments(recent),
    nearestLevel,
    nearestDistancePct:
      nearestLevel && close ? Number((((nearestLevel.price - close) / close) * 100).toFixed(2)) : null,
  };
}

function buildLevels(lowPrice: number, highPrice: number) {
  const levels: AutoLineLevel[] = [];
  let step = 0;
  while (step <= 100) {
    const price = lowPrice * (1 + step / 100);
    if (price > highPrice && step > 0) break;
    levels.push({
      label: step === 0 ? "0%" : `+${step}%`,
      percent: step,
      price: roundPrice(price),
    });
    step += 10;
  }
  return levels;
}

function buildTrendSegments(bars: KlineBar[]) {
  const highs = findPivots(bars, "high");
  const lows = findPivots(bars, "low");
  const upSegments = buildSegments(lows, "up", "上升趋势线");
  const downSegments = buildSegments(highs, "down", "下降趋势线");
  return [...upSegments, ...downSegments];
}

function findPivots(bars: KlineBar[], kind: "high" | "low") {
  const pivots: Pivot[] = [];
  const radius = 2;

  for (let index = radius; index < bars.length - radius; index += 1) {
    const current = Number(bars[index][kind]);
    const area = bars.slice(index - radius, index + radius + 1).map((bar) => Number(bar[kind]));
    const isPivot = kind === "high" ? current === Math.max(...area) : current === Math.min(...area);
    if (isPivot) {
      pivots.push({
        time: bars[index].time,
        price: current,
        index,
      });
    }
  }

  if (pivots.length >= 4) return pivots;

  const chunkSize = Math.max(8, Math.floor(bars.length / 6));
  for (let start = 0; start < bars.length; start += chunkSize) {
    const chunk = bars.slice(start, start + chunkSize);
    if (!chunk.length) continue;
    let pivotIndex = 0;
    chunk.forEach((bar, offset) => {
      const value = Number(bar[kind]);
      const pivotValue = Number(chunk[pivotIndex][kind]);
      if ((kind === "high" && value > pivotValue) || (kind === "low" && value < pivotValue)) {
        pivotIndex = offset;
      }
    });
    const bar = chunk[pivotIndex];
    pivots.push({
      time: bar.time,
      price: Number(bar[kind]),
      index: start + pivotIndex,
    });
  }

  return dedupePivots(pivots);
}

function buildSegments(pivots: Pivot[], direction: "up" | "down", label: string) {
  const pairs: AutoTrendSegment[] = [];
  for (let index = 0; index < pivots.length - 1; index += 1) {
    const start = pivots[index];
    const end = pivots[index + 1];
    if (end.index <= start.index) continue;
    pairs.push({
      id: `${direction}-${index}`,
      label: `${label} ${pairs.length + 1}`,
      direction,
      start,
      end,
    });
  }
  return pairs.slice(-2).map((item, index) => ({
    ...item,
    id: `${direction}-${index + 1}`,
    label: `${label} ${index + 1}`,
  }));
}

function dedupePivots(pivots: Pivot[]) {
  const sorted = [...pivots].sort((a, b) => a.index - b.index);
  return sorted.filter((pivot, index) => index === 0 || pivot.index !== sorted[index - 1].index);
}

function roundPrice(value: number) {
  return Number(value.toFixed(value >= 100 ? 2 : 3));
}

export function trendLabel(direction: AutoTrendDirection) {
  if (direction === "up") return "向上趋势";
  if (direction === "down") return "向下趋势";
  return "震荡观察";
}

export function defaultLineColors() {
  return { ...DEFAULT_COLORS };
}

export function loadLineColors(): AutoLineColorMap {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_COLORS, ...JSON.parse(raw) } : defaultLineColors();
  } catch {
    return defaultLineColors();
  }
}

export function saveLineColors(colors: AutoLineColorMap) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(colors));
}

export function colorForLevel(level: AutoLineLevel, colors: AutoLineColorMap, index = 0) {
  return colors[level.label] || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

