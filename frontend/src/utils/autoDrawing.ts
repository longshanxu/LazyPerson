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
const STORAGE_KEY = "lazy-person:auto-line-colors:v3";
const DEFAULT_YELLOW = "#f6d36b";
const DEFAULT_COLORS: AutoLineColorMap = {
  "0%": DEFAULT_YELLOW,
  "+10%": DEFAULT_YELLOW,
  "+20%": "#f24d4d",
  "+30%": DEFAULT_YELLOW,
  "+40%": DEFAULT_YELLOW,
  "+50%": "#1f6feb",
  "+60%": DEFAULT_YELLOW,
  "+70%": DEFAULT_YELLOW,
  "+80%": "#ffffff",
  "+90%": DEFAULT_YELLOW,
  "+100%": DEFAULT_YELLOW,
};

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
      label: "90自然日低点",
    },
    target: {
      time: highBar.time,
      price: highPrice,
      label: "90自然日高点",
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
  if (bars.length < 20) return [];
  const midpoint = Math.floor(bars.length / 2);
  const firstRange = rangePivots(bars.slice(0, midpoint), 0);
  const secondRange = rangePivots(bars.slice(midpoint), midpoint);
  if (!firstRange || !secondRange) return [];

  const firstCenter = (firstRange.high.price + firstRange.low.price) / 2;
  const secondCenter = (secondRange.high.price + secondRange.low.price) / 2;
  const direction: "up" | "down" = secondCenter >= firstCenter ? "up" : "down";
  const label = direction === "up" ? "向上通道" : "向下通道";

  return [
    segment(`${direction}-lower`, `${label} 下轨`, direction, firstRange.low, secondRange.low),
    segment(`${direction}-upper`, `${label} 上轨`, direction, firstRange.high, secondRange.high),
  ];
}

function rangePivots(bars: KlineBar[], offset: number) {
  if (!bars.length) return null;
  let highIndex = 0;
  let lowIndex = 0;
  bars.forEach((bar, index) => {
    if (Number(bar.high) > Number(bars[highIndex].high)) highIndex = index;
    if (Number(bar.low) < Number(bars[lowIndex].low)) lowIndex = index;
  });
  return {
    high: pivotFromBar(bars[highIndex], offset + highIndex, "high"),
    low: pivotFromBar(bars[lowIndex], offset + lowIndex, "low"),
  };
}

function pivotFromBar(bar: KlineBar, index: number, kind: "high" | "low"): Pivot {
  return {
    time: bar.time,
    price: Number(bar[kind]),
    index,
  };
}

function segment(
  id: string,
  label: string,
  direction: "up" | "down",
  start: Pivot,
  end: Pivot,
): AutoTrendSegment {
  return {
    id,
    label,
    direction,
    start,
    end,
  };
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
  if (level.label === "+20%") return "#f24d4d";
  if (level.label === "+50%") return "#1f6feb";
  if (level.label === "+80%") return "#ffffff";
  return colors[level.label] || DEFAULT_COLORS[level.label] || (index >= 0 ? DEFAULT_YELLOW : DEFAULT_YELLOW);
}
