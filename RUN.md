# Running the integrated system

## One-time setup

Everything runs from a **single** Python environment that has the web stack and
the model stack together. The system `python3` cannot load the models.

```bash
VENV=/Users/nawdddep/Documents/iceberg_models/iceberg_models-main/seaice_forecast/venv
$VENV/bin/pip install -r backend/requirements.txt
$VENV/bin/pip install joblib scikit-learn fastapi uvicorn httpx
```

## Start (two terminals)

**Backend — port 8600. Vite proxies to this exact port.**
```bash
cd ~/Documents/route_map/shipNavigation/backend
/Users/nawdddep/Documents/iceberg_models/iceberg_models-main/seaice_forecast/venv/bin/python \
  -m uvicorn app.main:app --host 127.0.0.1 --port 8600
```

**Frontend**
```bash
cd ~/Documents/route_map/shipNavigation/frontend
npm run dev
```

Open the URL Vite prints (5173 or 5174).

## Verify the models are actually live

The endpoints fall back to synthetic data rather than erroring, so a working
map does NOT prove the models loaded. Check the payload:

```bash
curl -s http://127.0.0.1:8600/api/sea-ice | head -c 200
```

Expect `"source":"UNet+ConvLSTM forecast (NSIDC CDR v6)"`.
If it says `"synthetic (data unavailable)"` the models did not load - almost
always the wrong Python interpreter.

Full check:

| endpoint | expected `source` |
|---|---|
| `/api/sea-ice` | UNet+ConvLSTM forecast (NSIDC CDR v6) |
| `/api/icebergs` | two-stage GBM drift model (3.96 km RMS @24h) |
| `/api/ocean-currents` | GLORYS12 reanalysis (CMEMS) |
| `/api/wind` | ERA5 reanalysis (ECMWF) |
| `/api/ice-risk` | IMO POLARIS on UNet+ConvLSTM forecast |

## Known gotchas

**Port.** Backend MUST be 8600. On 8000 you get `ECONNREFUSED` proxy errors for
every endpoint and the map silently shows nothing.

**Forecast date.** The processed archive ends **2018-12-20**, so that is the
default. Every layer accepts `?date=YYYY-MM-DD`. A winter date (e.g. 2018-08-15)
shows far more ice than the December default.

**normalization_stats.json.** If this is overwritten with a scalar
`{"mean":..,"std":..}` pair instead of per-variable entries, the model is fed
raw Kelvin and saturates to ~100% ice everywhere - a plausible-looking but
completely wrong map. The loader now detects this, logs an error, and falls
back to `normalization_stats.reference.json`. If you see that error, restore:

```bash
cd /Users/nawdddep/Documents/iceberg_models/iceberg_models-main/seaice_forecast
cp data/processed/normalization_stats.reference.json data/processed/normalization_stats.json
```

**Demo route.** Maitri -> Bharati is the real NCPOR voyage and both stations are
searchable. Switching `iceClass` between `none` and `pc1_pc7` visibly changes
the route: the PC vessel goes 61 nm shorter through 130 nm less ice.

## Honest state of the models

- **Iceberg drift**: 3.96 km RMS 24 h position error, 96.7% within 10 km.
  Beats the 2% rule by ~79% and a constant baseline in 5/5 CV folds.
- **Sea ice**: beats climatology ~3x at every horizon; roughly at persistence
  level, does NOT clearly beat it. See `OPEN_PROBLEM.md` in the models repo.
  Do not claim skill over persistence.
