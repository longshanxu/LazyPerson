from __future__ import annotations

from datetime import datetime

import pandas as pd

from backend.app.cache import CacheStore
from backend.app.config import Settings
from backend.app.errors import ProviderError
from backend.app.indicators import compute_indicators
from backend.app.models import DataQuality
from backend.app.providers.akshare_adapter import AKShareAdapter
from backend.app.providers.baostock_adapter import BaoStockAdapter
from backend.app.providers.efinance_adapter import EFinanceAdapter
from backend.app.utils import normalize_symbol, now_utc


class MarketService:
    default_watchlist = [
        {"symbol": "002138", "market": "SZ", "name": "顺络电子", "group_name": "default", "sort_order": 1, "note": "V3 自动画线测试标的"},
        {"symbol": "600519", "market": "SH", "name": "贵州茅台", "group_name": "default", "sort_order": 2, "note": ""},
        {"symbol": "000001", "market": "SZ", "name": "平安银行", "group_name": "default", "sort_order": 3, "note": ""},
        {"symbol": "300750", "market": "SZ", "name": "宁德时代", "group_name": "default", "sort_order": 4, "note": ""},
    ]

    def __init__(self, settings: Settings, cache: CacheStore):
        self.settings = settings
        self.cache = cache

    def _message_for(self, source: str, from_cache: bool = False, stale: bool = False, fallback: bool = False) -> str:
        if fallback:
            return "实时行情不可用，使用最新日 K 兜底"
        if stale:
            return "缓存数据已过期，可能滞后"
        if from_cache:
            return "使用本地缓存"
        if source == "efinance":
            return "东方财富数据"
        if source == "akshare":
            return "AKShare 数据"
        if source == "baostock":
            return "BaoStock 历史数据"
        if source == "sqlite":
            return "本地自选股数据"
        return "数据已更新"

    def _quality_from_meta(self, meta: dict, stale: bool | None = None, warnings: list[str] | None = None) -> DataQuality:
        updated = datetime.fromisoformat(meta["updated_at"]) if meta.get("updated_at") else None
        is_stale = meta.get("stale", False) if stale is None else stale
        source = meta.get("source", "cache")
        return DataQuality(
            source=source,
            from_cache=True,
            updated_at=updated,
            stale=is_stale,
            fallback=False,
            message=self._message_for(source, from_cache=True, stale=is_stale),
            warnings=warnings or ([] if not meta.get("stale") else ["stale_cache"]),
        )

    def _fetch_with_cache(
        self,
        cache_key: str,
        data_type: str,
        fetchers: list[tuple[str, callable]],
        ttl_seconds: int,
        symbol: str = "",
        period: str = "",
        refresh: bool = False,
    ) -> tuple[pd.DataFrame, DataQuality]:
        if not refresh:
            cached = self.cache.read_frame(cache_key, allow_stale=False)
            if cached:
                frame, meta = cached
                return frame, self._quality_from_meta(meta)

        warnings: list[str] = []
        for source, fetcher in fetchers:
            try:
                frame = fetcher()
                if frame is None or frame.empty:
                    warnings.append(f"{source}:empty")
                    continue
                start_at = str(frame.iloc[0].get("time", "")) if "time" in frame.columns else None
                end_at = str(frame.iloc[-1].get("time", "")) if "time" in frame.columns else None
                self.cache.write_frame(
                    cache_key=cache_key,
                    data_type=data_type,
                    frame=frame,
                    source=source,
                    symbol=symbol,
                    period=period,
                    ttl_seconds=ttl_seconds,
                    start_at=start_at,
                    end_at=end_at,
                )
                return frame, DataQuality(
                    source=source,
                    from_cache=False,
                    updated_at=now_utc(),
                    stale=False,
                    fallback=False,
                    message=self._message_for(source),
                    warnings=warnings,
                )
            except Exception as exc:
                if isinstance(exc, ProviderError):
                    warnings.append(f"{source}:{exc}")
                else:
                    warnings.append(f"{source}:{type(exc).__name__}")

        cached = self.cache.read_frame(cache_key, allow_stale=True)
        if cached:
            frame, meta = cached
            return frame, self._quality_from_meta(meta, stale=True, warnings=warnings + ["stale_cache"])
        raise ProviderError("; ".join(warnings) or "no provider returned data")

    def search_symbols(self, query: str, limit: int = 20, refresh: bool = False) -> tuple[list[dict], DataQuality]:
        cache_key = "symbols:all"
        if refresh or not self.cache.search_symbols(query, limit):
            frame, quality = self._fetch_with_cache(
                cache_key,
                "symbols",
                [("akshare", lambda: AKShareAdapter().symbols())],
                ttl_seconds=self.settings.symbols_ttl_seconds,
                refresh=refresh,
            )
            self.cache.upsert_symbols(frame.to_dict("records"))
        else:
            quality = DataQuality(
                source="sqlite",
                from_cache=True,
                updated_at=now_utc(),
                message=self._message_for("sqlite", from_cache=True),
            )
        rows = self.cache.search_symbols(query, limit)
        for row in rows:
            row["display"] = f"{row['symbol']}.{row.get('market', '')} {row.get('name', '')}".strip()
        return rows, quality

    def realtime_quotes(self, symbols: list[str], refresh: bool = False) -> tuple[list[dict], DataQuality]:
        clean_symbols = [normalize_symbol(symbol) for symbol in symbols if symbol.strip()]
        cache_key = f"quote:realtime:{','.join(sorted(clean_symbols))}"
        try:
            frame, quality = self._fetch_with_cache(
                cache_key,
                "quote",
                [
                    ("efinance", lambda: EFinanceAdapter().realtime_quotes(clean_symbols)),
                    ("akshare", lambda: AKShareAdapter().realtime_quotes(clean_symbols)),
                ],
                ttl_seconds=self.settings.quote_ttl_seconds,
                symbol="_".join(clean_symbols),
                refresh=refresh,
            )
            return frame.to_dict("records"), quality
        except ProviderError as exc:
            rows: list[dict] = []
            for symbol in clean_symbols:
                try:
                    payload, _ = self.kline(symbol, period="day", indicators=[], refresh=False)
                except ProviderError:
                    continue
                if not payload["bars"]:
                    continue
                latest = payload["bars"][-1]
                previous = payload["bars"][-2] if len(payload["bars"]) > 1 else {}
                close = latest.get("close")
                pre_close = previous.get("close")
                rows.append(
                    {
                        "symbol": symbol,
                        "market": "",
                        "name": "",
                        "trade_time": latest.get("time"),
                        "price": close,
                        "open": latest.get("open"),
                        "high": latest.get("high"),
                        "low": latest.get("low"),
                        "pre_close": pre_close,
                        "pct_chg": latest.get("pct_chg"),
                        "change": (close - pre_close) if close is not None and pre_close is not None else None,
                        "volume": latest.get("volume"),
                        "amount": latest.get("amount"),
                        "turnover": latest.get("turnover"),
                    }
                )
            if rows:
                return rows, DataQuality(
                    source="kline_fallback",
                    from_cache=True,
                    updated_at=now_utc(),
                    stale=True,
                    fallback=True,
                    message=self._message_for("kline_fallback", from_cache=True, stale=True, fallback=True),
                    warnings=["realtime_unavailable", str(exc)],
                )
            raise

    def kline(
        self,
        symbol: str,
        period: str = "day",
        start: str | None = None,
        end: str | None = None,
        adjust: str | None = None,
        indicators: list[str] | None = None,
        limit: int | None = None,
        refresh: bool = False,
    ) -> tuple[dict, DataQuality]:
        clean = normalize_symbol(symbol)
        adjust = adjust or self.settings.default_adjust
        data_type = "kline_day" if period == "day" else "kline_minute"
        ttl = self.settings.day_ttl_seconds if period == "day" else self.settings.minute_ttl_seconds
        cache_key = f"{data_type}:{clean}:{period}:{adjust}:{start or ''}:{end or ''}"
        fetchers: list[tuple[str, callable]] = []
        if period == "day":
            fetchers = [
                ("akshare", lambda: AKShareAdapter().kline(clean, period, start, end, adjust)),
                ("baostock", lambda: BaoStockAdapter().kline(clean, start, end, adjust)),
                ("efinance", lambda: EFinanceAdapter().kline(clean, period, start, end, adjust)),
            ]
        else:
            fetchers = [
                ("efinance", lambda: EFinanceAdapter().kline(clean, period, start, end, adjust)),
                ("akshare", lambda: AKShareAdapter().kline(clean, period, start, end, adjust)),
            ]
        frame, quality = self._fetch_with_cache(
            cache_key,
            data_type,
            fetchers,
            ttl_seconds=ttl,
            symbol=clean,
            period=period,
            refresh=refresh,
        )
        full_indicator_payload = compute_indicators(frame, indicators or []) if indicators else {}
        if limit and limit > 0:
            frame = frame.tail(limit).reset_index(drop=True)
            indicator_payload = {
                group: {name: values[-limit:] for name, values in series.items()}
                for group, series in full_indicator_payload.items()
            }
        else:
            indicator_payload = full_indicator_payload
        return {
            "symbol": clean,
            "period": period,
            "adjust": adjust,
            "bars": frame.to_dict("records"),
            "indicators": indicator_payload,
        }, quality

    def money_flow(self, symbol: str, period: str = "day", refresh: bool = False) -> tuple[dict, DataQuality]:
        clean = normalize_symbol(symbol)
        cache_key = f"money_flow:{clean}:{period}"
        frame, quality = self._fetch_with_cache(
            cache_key,
            "money_flow",
            [
                ("efinance", lambda: EFinanceAdapter().money_flow(clean)),
                ("akshare", lambda: AKShareAdapter().money_flow(clean)),
            ],
            ttl_seconds=self.settings.money_flow_ttl_seconds,
            symbol=clean,
            period=period,
            refresh=refresh,
        )
        return {"symbol": clean, "items": frame.to_dict("records")}, quality

    def list_watchlist(self, group_name: str | None = None) -> list[dict]:
        rows = self.cache.list_watchlist(group_name)
        existing = {row["symbol"] for row in rows}
        for item in self.default_watchlist:
            if item["symbol"] in existing:
                continue
            if group_name and item["group_name"] != group_name:
                continue
            self.cache.upsert_symbols([item])
            self.cache.add_watchlist(item["symbol"], item["group_name"], item["note"])
        rows = self.cache.list_watchlist(group_name)
        if rows:
            return rows
        return self.cache.list_watchlist(group_name)

    def add_watchlist(self, symbol: str, group_name: str = "default", note: str = "") -> None:
        self.cache.add_watchlist(normalize_symbol(symbol), group_name, note)

    def remove_watchlist(self, symbol: str, group_name: str | None = None) -> None:
        self.cache.remove_watchlist(normalize_symbol(symbol), group_name)

    def clear_cache(self, data_type: str | None = None, symbol: str | None = None) -> int:
        return self.cache.clear(data_type=data_type, symbol=normalize_symbol(symbol) if symbol else None)
