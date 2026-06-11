import tempfile
import unittest
from pathlib import Path

import pandas as pd

from backend.app.cache import CacheStore


class DummySettings:
    def __init__(self, root: Path):
        self.cache_dir = root
        self.sqlite_path = root / "lazy_person.sqlite"


class CacheTests(unittest.TestCase):
    def test_watchlist_and_frame_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache = CacheStore(DummySettings(Path(tmp)))
            cache.upsert_symbols([
                {"symbol": "600519", "market": "SH", "name": "贵州茅台", "pinyin": "", "listed_at": None}
            ])
            cache.add_watchlist("600519")
            self.assertEqual(cache.list_watchlist()[0]["symbol"], "600519")

            frame = pd.DataFrame([{"time": "2026-06-10", "close": 100.0}])
            cache.write_frame(
                cache_key="kline_day:600519",
                data_type="kline_day",
                frame=frame,
                source="test",
                symbol="600519",
                ttl_seconds=60,
            )
            cached = cache.read_frame("kline_day:600519")
            self.assertIsNotNone(cached)
            cached_frame, meta = cached
            self.assertEqual(cached_frame.iloc[0]["close"], 100.0)
            self.assertFalse(meta["stale"])


if __name__ == "__main__":
    unittest.main()

