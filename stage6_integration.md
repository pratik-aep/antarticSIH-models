# Stage 6 Integration Analysis

## Executive Verdict

Integration is technically feasible, but the external repository is not a single drop-in navigation model. It contains three different capability levels:

| Capability | External status | Integration decision |
|---|---|---|
| Antarctic sea-ice concentration forecasting | Trained Phase 1 and Phase 2 U-Net checkpoints, plus newer ConvLSTM and multi-horizon architectures | Integrate first as a polar risk/forecast service, behind an adapter |
| Risk-aware polar routing | A* pathfinding, IMO POLARIS-inspired risk, fuel and speed models | Reuse concepts and selected modules; adapt grid and coordinate handling before production use |
| Iceberg trajectory prediction | Physics, PINN, LSTM/GRU/Transformer, ensemble and uncertainty code | Feasible as a separate predictor, but no verified production checkpoint and no operational API contract were found |

The safest target architecture is:

```text
POST /api/route
    -> existing global land-safe route geometry
    -> optional environment provider
         -> weather/current forecast
         -> Antarctic SIC forecast
         -> iceberg trajectories
    -> cached risk/time/fuel scoring
    -> route alternatives and metrics
```

Do not replace the current global `LandMask`/A* router with the external Antarctic polar-stereographic router. The two systems use different domains, projections, resolutions, and meanings of a grid cell.

## What Is Currently in shipNavigation

The current application already has request fields for `optimizeFor`, `vesselType`, `draftMeters`, and `iceClass` in `backend/app/main.py`, and the frontend sends them. The route engine in `backend/app/route_engine.py` currently provides:

- Global 0.5 degree geographic water/land grid with A* and artificial waterway shortcuts.
- Distance, time, fuel estimate, sea-ice metrics, ECA distance, and chokepoint crossings.
- Synthetic current and wind formulas embedded in the A* loop and final segment timing.
- Synthetic sea-ice concentration from `backend/app/sea_ice.py`.
- Mock iceberg seeds and physics drift in `backend/app/iceberg_engine.py`.
- Open-Meteo weather/marine samples after a route is computed in `backend/app/weather_engine.py`.
- Frontend map layers for sea ice, currents, wind, weather, and iceberg trajectories.

The important current limitation is that the route engine's environmental values are not forecast-model outputs. They are synthetic fields or post-route observations/fallbacks, and the current route search does not consume the fetched route-weather samples.

## What Was Updated in the External Repository

### 1. Environmental sea-ice forecasting

The external `seaice_forecast` project adds a real-data pipeline for Antarctic SIC forecasting:

- NOAA/NSIDC CDR v6 SIC target data.
- ERA5 wind U/V, 2 m air temperature, and SST.
- Copernicus Marine GLORYS12V1 ocean current U/V.
- Regridding to the NSIDC Antarctic polar stereographic PS25 grid.
- Daily temporal alignment and training-split-only normalization.
- 49-channel input: 7 days x 7 variables (`sic`, `wind_u`, `wind_v`, `air_temp`, `sst`, `current_u`, `current_v`).
- U-Net output: next-day SIC field, bounded to `[0, 1]`.

Relevant implementation areas:

- `seaice_forecast/src/seaice_forecast/data_processing/`
- `seaice_forecast/src/seaice_forecast/models/unet.py`
- `seaice_forecast/src/seaice_forecast/models/unet_convlstm.py`
- `seaice_forecast/src/seaice_forecast/models/multi_horizon.py`
- `seaice_forecast/checkpoints/`

### 2. The measured Phase 2 result is worse than the baseline

The external evaluation is important for the integration decision. On its 63-sample test set:

| Model | MAE | RMSE | Ice-edge displacement |
|---|---:|---:|---:|
| Persistence | 0.00496 | 0.01177 | 5.79 km |
| Phase 1 SIC-only U-Net | 0.00769 | 0.01826 | 19.99 km |
| Phase 2 environmental U-Net | 0.00953 | 0.02248 | 837.71 km* |

`MODEL_VERSION_PHASE2` reports that Phase 2 is 24.02% worse than Phase 1 on MAE and that persistence is the strongest one-day forecast. The 837.71 km ice-edge value is also flagged as a contouring issue in the report. Therefore, Phase 2 must not be treated as a validated improvement merely because it uses more environmental variables.

This does not make the model useless for routing. It means it should initially be used as a forecast/risk input with confidence metadata and compared against persistence, climatology, and the current fallback. It should not be the sole authority for declaring a route safe.

### 3. New temporal and multi-horizon architectures

`UNetConvLSTM` adds temporal modeling at the U-Net bottleneck. It accepts `[B, T, C, H, W]` or flattened `[B, T*C, H, W]` and predicts the next SIC field.

`MultiHorizonForecaster` provides two strategies:

- Direct heads for horizons such as +1, +3, +5, and +7 days.
- Recursive autoregressive rollout, with optional future environmental forcing.

These are more suitable for route ETA windows than the one-day Phase 2 U-Net, but the repository inventory shows architecture and training code rather than a verified shipped operational checkpoint for these newer models. They require a real training/evaluation run before production routing use.

### 4. Polar route optimization and navigation cost models

The external `seaice_forecast/src/seaice_forecast/routing/pathfinding.py` provides:

- Cost-grid construction from SIC and a POLARIS-inspired risk function.
- 4- or 8-connected A*/Dijkstra.
- Land and invalid-cell exclusion.
- Path distance, path cost, and risk summaries.

The `risk/polaris.py` module maps SIC and polar class to a bounded risk score. The `fuel/consumption.py` module estimates ice-dependent attainable speed, transit time, and fuel per cell.

These are useful domain components, but they are Antarctic PS25 grid algorithms. They do not understand shipNavigation's latitude/longitude grid, global antimeridian wrapping, canal shortcuts, port snapping, ECA polygons, or final polyline invariants.

### 5. Iceberg drift prediction and uncertainty

The external `iceberg_drift_model` contains:

- A physics model using current, wind drag, and Southern/Northern Hemisphere Coriolis deflection.
- LSTM, GRU, Transformer, and MLP sequence-to-sequence models.
- PINN and hybrid models that add ML residuals to physics drift.
- Ensemble and Monte Carlo-dropout uncertainty utilities.
- A `DriftPredictor` inference interface accepting historical positions plus current/wind U/V series.

The inference contract expects a trained PyTorch checkpoint, a feature-engineering schema, and at least 24 hours of historical data at 6-hour steps. The repository README still lists real-data integration, an operational API, and some model work as roadmap items. The available top-level checkpoint inventory is for sea-ice SIC models; no verified iceberg-drift checkpoint with documented validation metrics was identified. Treat this package as research code until a checkpoint, training provenance, feature columns, and holdout performance are supplied.

## Feasibility by Integration Goal

| Goal | Feasibility | Main blocker |
|---|---|---|
| Show external Antarctic SIC forecast on the map | High | Reprojection from PS25 to lat/lon and model loading dependencies |
| Add SIC-based polar risk to existing route scoring | Medium-high | Resampling geographic route cells into PS25 and caching forecasts |
| Use SIC forecast to alter global A* geometry | Medium | Domain mismatch, forecast time indexing, performance, and validation |
| Replace synthetic currents/wind with real forecasts | Medium | Need a common time/location interpolation provider and network/data policy |
| Use external iceberg predictor for `/api/icebergs` | Medium | No verified checkpoint plus feature/history schema and calibration |
| Use iceberg predictions as hard A* obstacles | Low initially | Uncertainty, moving hazards, node-time coupling, and safety validation |
| Use the external Antarctic pathfinder as the global router | Low | Different projection, domain, grid resolution, and route semantics |

## Recommended Integration Boundary

Create an environment/model adapter instead of importing the external project throughout `route_engine.py`.

```python
class EnvironmentProvider(Protocol):
    def sample(self, lat: float, lon: float, timestamp: datetime) -> EnvironmentSample: ...

class EnvironmentSample:
    current_u_ms: float
    current_v_ms: float
    wind_u_ms: float
    wind_v_ms: float
    wave_height_m: float | None
    sic_fraction: float | None
    sic_uncertainty: float | None
    source: str
    valid: bool
```

Add separate model adapters:

```text
backend/app/environment_provider.py     # protocol, fallback, interpolation, cache
backend/app/seaice_model_adapter.py     # PS25 model loading/inference/reprojection
backend/app/iceberg_model_adapter.py    # optional DriftPredictor wrapper
backend/app/route_costs.py              # time, fuel, SIC risk, uncertainty policy
```

The route engine should receive a provider and a policy object. It should not know whether a value came from PyTorch, NetCDF, Open-Meteo, or a fallback formula.

## Required Data and Coordinate Adaptation

### SIC forecast grid

The external forecast is on EPSG:3031 Antarctic polar stereographic coordinates, approximately 25 km resolution, with array dimensions documented as 316 x 332. shipNavigation uses `(lat, lon)` on a global 0.5 degree geographic grid. Integration therefore needs:

1. Load the model's exact grid coordinates and land/ocean mask.
2. Convert route sample points from WGS84 latitude/longitude to EPSG:3031 using `pyproj`.
3. Bilinearly or nearest-neighbor sample the SIC prediction and uncertainty at those projected coordinates.
4. Reject or mark unavailable points outside the model domain instead of interpreting them as zero ice.
5. Preserve the forecast timestamp and model version in the route response.

Do not copy the 332 x 316 array into the global `LandMask`. It is a regional environmental layer, not a global navigability mask.

### Forecast time alignment

For each route segment, estimate arrival time from the current route timing, then sample the forecast valid at that time. For a multi-day route, use the +1/+3/+5/+7 outputs or a documented recursive rollout. If the route extends beyond the model horizon, use the provider fallback and expose that fact.

### Units and conventions

- SIC must be normalized to a fraction in `[0, 1]`; the frontend may display a percentage.
- Wind/current inputs are U eastward and V northward in m/s.
- Route distances remain nautical miles.
- Fuel outputs need one explicit vessel calibration; the external fuel default is for a polar research vessel and must not silently describe every cargo/tanker vessel.
- Polar Class (`PC1`-`PC7`) is not equivalent to the current `iceClass` values (`none`, `pc1_pc7`, `icebreaker`). Add an explicit mapping and reject ambiguous values.

## Proposed API Evolution

Keep the current `/api/route` request backward compatible, then add optional fields:

```json
{
  "optimizeFor": "distance|time|fuel|safety|risk",
  "environmentMode": "fallback|forecast|strict",
  "forecastModel": "sic_unet_v001|sic_unet_env_v001|unet_convlstm|none",
  "forecastHorizonDays": 7,
  "polarClass": "PC4",
  "useIcebergAvoidance": false,
  "uncertaintyPolicy": "penalize|report_only|block_high_risk"
}
```

Recommended response additions:

```json
{
  "environment": {
    "model": "...",
    "dataSources": ["NSIDC", "ERA5", "GLORYS"],
    "forecastValidThroughUTC": "...",
    "fallbackUsed": false
  },
  "risk": {
    "meanIceRisk": 0.0,
    "maxIceRisk": 0.0,
    "highRiskDistanceNm": 0.0,
    "iceDataCoveragePct": 0.0,
    "uncertaintyCoveragePct": 0.0
  },
  "legs": [
    {
      "environmentSamples": [],
      "dataQuality": "forecast|fallback|unavailable"
    }
  ]
}
```

Use `strict` mode for evaluation and operations: if required forecast data are unavailable, return a controlled error rather than silently substituting synthetic values. Keep `fallback` mode for the current demo experience.

## File-by-File Integration Plan

### Phase 6A: Adapter and observation-only integration

1. Add `environment_provider.py` with a typed sample contract, timestamp normalization, spatial/time cache, and the current synthetic formulas as a fallback provider.
2. Add `seaice_model_adapter.py` that loads one validated SIC checkpoint once at application startup, selects CPU/MPS safely, and exposes point/grid sampling.
3. Add a diagnostics endpoint such as `GET /api/environment/status` reporting model loaded, checkpoint path/version, coverage, and fallback state.
4. Extend `/api/route` response with environment provenance and sampled SIC/risk metrics, without changing route geometry.
5. Add a map overlay endpoint for forecast SIC and uncertainty, reprojected to GeoJSON or tiles.

This phase is low risk and proves the model/data contract before it affects navigation.

### Phase 6B: Risk-aware scoring

1. Refactor current embedded current/wind/ice formulas out of `route_engine.py` into `route_costs.py`.
2. Add a provider-backed edge cost for `time`, `fuel`, and `safety`.
3. Use a conservative risk formulation: distance/time cost plus POLARIS-inspired SIC risk plus an uncertainty penalty. Keep land, ice-cap, diagonal-corner, ECA, and waterway rules as hard constraints.
4. Cache samples by `(model_version, forecast_time_bucket, grid_cell)` so A* does not invoke PyTorch or NetCDF interpolation repeatedly.
5. Recalculate final duration and fuel from the returned path using the same provider values used during search. This preserves the existing distance consistency invariant and prevents route/search metric disagreement.

### Phase 6C: Temporal and multi-horizon forecasting

1. Train and validate `UNetConvLSTM` or `MultiHorizonForecaster` on a complete, documented real-data split.
2. Compare against persistence and the existing SIC-only U-Net at each horizon.
3. Export a stable inference artifact containing architecture config, normalization stats, grid coordinates, mask, model version, and calibration metrics.
4. Support only horizons validated by the artifact; do not extrapolate +7 day output to arbitrary voyage lengths.

### Phase 6D: Iceberg prediction

1. Obtain or train a checkpoint for the external `DriftPredictor`.
2. Freeze and version the exact feature order, normalization, sequence length, timestep, forcing source, and iceberg dimensions.
3. Wrap it in `iceberg_model_adapter.py` and preserve the existing `/api/icebergs` response shape (`id`, trajectory points, timestamps, speed/heading).
4. Return uncertainty bands and model provenance.
5. Initially use iceberg proximity as a reported risk/soft penalty. Only hard-block a route after validation against historical tracks and a documented false-negative policy.

## Dependency and Deployment Assessment

The current backend requirements are deliberately light: FastAPI, Uvicorn, Shapely, and Pydantic. The external model stack adds PyTorch, NumPy, xarray, NetCDF4, SciPy, pyproj, pandas, and potentially CDS/CMEMS clients. The iceberg package additionally requires a much larger scientific/ML stack and declares Python `>=3.11`, while shipNavigation currently documents Python 3.10+.

Recommended deployment options:

| Option | Recommendation | Reason |
|---|---|---|
| Install every external dependency into the route backend | Avoid initially | Large image, startup/memory impact, dependency conflicts, slow request path |
| Vendor only pure Python risk/fuel functions | Good for Phase 6B | Small, deterministic, easy to test; still requires license/provenance review |
| Separate forecast worker/service | Best for production | Isolates PyTorch/NetCDF, permits model warm-up and caching, independent scaling |
| Offline batch forecast artifacts | Best for demo/offline mode | Predictable latency and no credentials/network dependency during routing |

For the first implementation, use an optional forecast worker or offline artifact directory. The FastAPI route backend can fall back to existing formulas if the worker is unavailable, while strict evaluation mode exposes the failure.

## Risks and Required Mitigations

### Model validity

The external Phase 2 environmental U-Net did not beat persistence or Phase 1. Require benchmark reports for every candidate checkpoint and reject unvalidated checkpoints from default routing.

### Projection and resolution mismatch

PS25 and the global 0.5 degree grid cannot be merged by array indexing. Build and test a WGS84-to-EPSG:3031 sampler, including Antarctic coast, dateline-adjacent longitudes, and out-of-domain points.

### A* performance

Model inference inside the neighbor loop would make route computation unpredictable. Precompute a cost raster for the route time window or cache cell/time samples. Benchmark route latency and closed-node count.

### Temporal circularity

Arrival time depends on route cost, while route cost depends on forecast time. Use a bounded two-pass method first: initial ETA from baseline, forecast-aware route, then recompute final ETA. Document that approximation before attempting time-expanded A*.

### Safety semantics

A forecast is not a navigational clearance. Land and known geometry remain hard constraints; SIC, iceberg, weather, and uncertainty are costs or operational warnings until validated. Never convert missing data to safe/open water without a visible provenance flag.

### Data and credentials

The external training pipeline references NSIDC, ERA5, and Copernicus Marine data, with large local datasets and credentials. Runtime integration should consume versioned processed artifacts rather than download training data during an API request.

### Existing algorithm defects

The handoff already records `_ensure_safe` index mismatch, port snapping, and canal-choice issues. Model integration should not obscure these. Run the existing chokepoint/canal acceptance routes before and after every cost-function change.

## Validation and Acceptance Plan

### Adapter tests

- Load the selected checkpoint and run one deterministic inference on a fixed fixture.
- Confirm tensor shape, variable order, normalization, output range, grid metadata, and device fallback.
- Sample known Antarctic points and verify the result is finite and geographically plausible.
- Verify points outside the Antarctic model domain return `unavailable`, not zero SIC.

### Routing regression tests

Preserve all existing handoff examples: Palk, Dardanelles, Suez, Hormuz, Panama, and Mumbai-to-Rotterdam. Also assert:

- Interior path remains land-safe.
- Returned distance equals the returned polyline geodesic sum.
- Crossings and ECA distance remain ordered and stable.
- `distance` mode does not change when the environment provider is unavailable.
- `forecast` mode records model provenance.
- `strict` mode fails clearly when required data are missing.

### Model comparison tests

For each candidate forecast model and horizon, compare:

- Persistence.
- Existing SIC-only U-Net.
- Environmental U-Net.
- ConvLSTM or multi-horizon candidate.
- Fallback/synthetic provider where relevant.

Report SIC MAE/RMSE/correlation, ice-edge displacement, route distance, ETA, fuel, risk exposure, compute latency, and fallback coverage. A model should affect the default route only after it wins or materially improves the operational metric without violating safety invariants.

## Recommended Immediate Scope

The most feasible first deliverable is **observation-only SIC integration**:

1. Package one validated SIC checkpoint and its normalization/grid metadata.
2. Add a provider adapter and cache.
3. Expose model status and forecast overlay.
4. Add SIC/risk summaries to `/api/route` without changing geometry.
5. Compare forecast-aware scoring offline against current routes.

After that comparison is stable, enable forecast-aware `safety` or `fuel` scoring behind an explicit feature flag. Leave the existing distance route as the default until the external temporal models have real-data evaluation and the iceberg model has a verified checkpoint and uncertainty calibration.

## Bottom Line

The repository contains valuable improvements: environmental data handling, temporal SIC architectures, multi-horizon forecasting, polar risk scoring, ice-dependent fuel modeling, and physics-informed iceberg prediction. The integration boundary is strong, but the models are not interchangeable with the current global route engine. The SIC artifacts are the nearest practical integration target; the Phase 2 result argues for cautious, benchmark-driven use. The iceberg predictor and newer temporal models should be treated as optional research services until their checkpoints, data contracts, and validation results are made explicit.