import pandas as pd


def compute_returns(prices_df: pd.DataFrame) -> pd.DataFrame:
    df = prices_df.copy()
    df["ret"] = df["close"].pct_change()
    return df.dropna().reset_index(drop=True)
