import asyncio
from datetime import date
from typing import Optional

import uvicorn
from fastapi import FastAPI, HTTPException

from server.schemas import RunRequest, RunResponse, PriceResponse
from server.services.data_provider.yahoo import YahooPriceProvider
from server.services.engine import run_pipeline


app = FastAPI(title="QuantPro Dynamics", version="0.1")


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/prices/{ticker}", response_model=PriceResponse)
async def get_prices(ticker: str, start: Optional[date] = None, end: Optional[date] = None):
    provider = YahooPriceProvider()
    try:
        df = await provider.fetch_prices(ticker, start, end)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return PriceResponse.from_df(ticker, df)


@app.post("/run", response_model=RunResponse)
async def run_model(req: RunRequest):
    try:
        result = await run_pipeline(req)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return result


if __name__ == "__main__":
    uvicorn.run("server.main:app", host="0.0.0.0", port=8000, reload=True)
