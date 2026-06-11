from datetime import datetime, timezone
from typing import Any

import pandas as pd


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def normalize_symbol(symbol: str) -> str:
    return symbol.strip().upper().replace(".SH", "").replace(".SZ", "").replace(".BJ", "")


def guess_market(symbol: str) -> str:
    clean = normalize_symbol(symbol)
    if clean.startswith(("5", "6", "9")):
        return "SH"
    if clean.startswith(("0", "2", "3")):
        return "SZ"
    if clean.startswith(("4", "8")):
        return "BJ"
    return ""

