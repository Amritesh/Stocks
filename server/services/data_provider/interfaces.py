from datetime import date
from typing import Optional

import pandas as pd


class PriceProvider:
    async def fetch_prices(self, ticker: str, start: Optional[date] = None, end: Optional[date] = None) -> pd.DataFrame:
        raise NotImplementedError

    async def last_price(self, ticker: str) -> float:
        prices = await self.fetch_prices(ticker)
        return float(prices.sort_values("date").iloc[-1]["close"])


class EventProvider:
    async def fetch_events(self, ticker: str, start: Optional[date] = None, end: Optional[date] = None):
        raise NotImplementedError
