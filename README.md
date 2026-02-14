# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
# Stocks Monte Carlo Dashboard

## New backend scaffold (physics-inspired engine)

- FastAPI app in `server/main.py` with `/run` and `/prices/{ticker}` endpoints.
- Data providers abstraction in `server/services/data_provider/` (Yahoo stub).
- Engine placeholder in `server/services/engine.py` that will be replaced by full factor/regime models.
- Install backend deps: `python -m venv .venv && source .venv/bin/activate && pip install -r server/requirements.txt`
- Run backend: `uvicorn server.main:app --reload --port 8000`

## Frontend additions

- API client in `src/api/client.js` hits local FastAPI.
- Decision boundary tab added with CE comparison placeholder.

## Next steps to productionize models

- Replace engine placeholder with Stage 1 Kalman + Student-t, posterior predictive.
- Add HMM/regime, jump components per spec.
- Wire charts for betas, regimes, predictive histograms, diagnostics.
