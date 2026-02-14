from datetime import date
from typing import List, Optional

from pydantic import BaseModel, Field


class PricePoint(BaseModel):
    date: date
    open: float
    high: float
    low: float
    close: float
    volume: float


class PriceResponse(BaseModel):
    ticker: str
    source: str
    prices: List[PricePoint]

    @classmethod
    def from_df(cls, ticker, df, source: str = "Yahoo"):
        records = [
            PricePoint(
                date=row["date"],
                open=row["open"],
                high=row["high"],
                low=row["low"],
                close=row["close"],
                volume=row.get("volume", 0.0),
            )
            for _, row in df.iterrows()
        ]
        return cls(ticker=ticker, source=source, prices=records)


class RunRequest(BaseModel):
    ticker: str
    buy_date: date
    buy_price: float
    horizon: int = Field(ge=1, le=756)
    paths: int = Field(ge=500, le=20000)
    confidence: float = Field(gt=0, lt=1)
    risk_aversion: float = Field(gt=0)
    benchmark: str = "^NSEI"
    drawdown_pct: float = 0.1
    target_pct: float = 0.1


class BandPoint(BaseModel):
    date: date
    p10: float
    p50: float
    p90: float


class BuyRange(BaseModel):
    label: str
    tenor: int
    low: float
    high: float


class RiskStats(BaseModel):
    prob_target: float
    prob_drawdown: float
    var_95: float
    es_95: float
    realized_return: float
    realized_elapsed: float
    percentile_elapsed: float
    elapsed_days: int
    current_price: float


class CEComparison(BaseModel):
    ce_stay: float
    ce_switch: float
    prob_ce_stay_gt: float
    delta_ce: float


class HealthMetrics(BaseModel):
    coverage: float
    log_lik: float
    residual_break_prob: float


class RunResponse(BaseModel):
    bands: List[BandPoint]
    betas: List[float]
    regimes: List[float]
    luck_score: float
    ce: CEComparison
    health: HealthMetrics
    buy_ranges: List[BuyRange]
    stats: RiskStats
    decision: str
    decision_text: Optional[str] = None
    message: Optional[str] = None
