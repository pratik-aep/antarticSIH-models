# Running the integrated system

## Start

```bash
./start.sh
```

That is the whole thing. `start.sh` finds the model environment itself
(`../seaice_forecast/venv`, which already has torch/joblib/scikit-learn from
training), installs the web stack into it if needed, starts both servers, and
prints whether the models came up:

```
[backend]  ready at  http://127.0.0.1:8600
[models]   LIVE — sea ice, iceberg drift, POLARIS risk
```

If it prints `DEGRADED` or a `WARNING: no model-capable venv`, the app is
running on **simulated** data. Open the URL Vite prints and check the status
badge under the panel header — it says the same thing in the UI.

### Overrides

| variable | purpose | default |
|---|---|---|
| `BACKEND_PORT` | backend port (Vite's proxy follows it) | `8600` |
| `ICEBERG_MODEL_ROOT` | where the models repo lives | the parent directory |
| `MODEL_VENV` | interpreter with the model deps | `$ICEBERG_MODEL_ROOT/seaice_forecast/venv` |

The models are resolved **relative** to this checkout, so no absolute paths are
baked in; set `ICEBERG_MODEL_ROOT` only if the two repos are checked out apart.

### Standalone backend environment

To run the backend outside the training venv:

```bash
pip install -r backend/requirements-models.txt   # includes requirements.txt
```

Installing only `requirements.txt` gives you the web stack **without** the
models, i.e. the synthetic fallback.

## Verify the models are actually live

Endpoints fall back to synthetic data rather than erroring, so a working map
does NOT prove the models loaded. One call answers it:

```bash
curl -s http://127.0.0.1:8600/api/model-status
```

`"allLive": true` means all three are real. Anything else lists which component
failed and why, per artifact. The UI badge reads the same endpoint, and
`/api/route` responses carry `iceDataSource` naming the field that costed the
route.

Per-layer `source` strings, if you want to check them individually:

| endpoint | expected `source` |
|---|---|
| `/api/sea-ice` | UNet+ConvLSTM forecast (NSIDC CDR v6) |
| `/api/icebergs` | two-stage GBM drift model (3.96 km RMS @24h) |
| `/api/ocean-currents` | GLORYS12 reanalysis (CMEMS) |
| `/api/wind` | ERA5 reanalysis (ECMWF) |
| `/api/ice-risk` | IMO POLARIS on UNet+ConvLSTM forecast |

## Known gotchas

**Port.** Backend and Vite proxy must agree. `start.sh` keeps them in sync via
`BACKEND_PORT`; if you start the two by hand, pass the same value to both
(`BACKEND_PORT=8601 npm run dev`). A mismatch gives `ECONNREFUSED` proxy errors
for every endpoint and the map silently shows nothing. Note that an unrelated
service already listening on 8600 produces the same symptom in reverse — the
proxy connects, to the wrong app.

**Forecast date.** The processed archive ends **2018-12-20**, so that is the
default. Every layer accepts `?date=YYYY-MM-DD`. A winter date (e.g. 2018-08-15)
shows far more ice than the December default.

**normalization_stats.json.** If this is overwritten with a scalar
`{"mean":..,"std":..}` pair instead of per-variable entries, the model is fed
raw Kelvin and saturates to ~100% ice everywhere - a plausible-looking but
completely wrong map. The loader now detects this, logs an error, and falls
back to `normalization_stats.reference.json`. If you see that error, restore:

```bash
cd "$(git rev-parse --show-toplevel)/../seaice_forecast/data/processed"
cp normalization_stats.reference.json normalization_stats.json
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
