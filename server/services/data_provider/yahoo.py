from datetime import date
from typing import Optional

import pandas as pd
import httpx

from server.services.data_provider.interfaces import PriceProvider, EventProvider


YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"


class YahooPriceProvider(PriceProvider):
    async def fetch_prices(self, ticker: str, start: Optional[date] = None, end: Optional[date] = None) -> pd.DataFrame:
        params = {"interval": "1d", "range": "5y"}
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.get(YAHOO_CHART_URL.format(ticker=ticker), params=params)
            r.raise_for_status()
            data = r.json()
        result = data["chart"]["result"][0]
        ts = result["timestamp"]
        quote = result["indicators"]["quote"][0]
        df = pd.DataFrame({
            "date": pd.to_datetime(ts, unit="s").date,
            "open": quote.get("open"),
            "high": quote.get("high"),
            "low": quote.get("low"),
            "close": quote.get("close"),
            "volume": quote.get("volume"),
        })
        df = df.dropna(subset=["close"]).reset_index(drop=True)
        if start:
            df = df[df["date"] >= start]
        if end:
            df = df[df["date"] <= end]
        return df


class YahooEventProvider(EventProvider):
    async def fetch_events(self, ticker: str, start: Optional[date] = None, end: Optional[date] = None):
        # Placeholder: extend with Yahoo calendar or paid NSE vendor
        return []
