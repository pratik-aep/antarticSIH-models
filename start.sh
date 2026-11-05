#!/usr/bin/env bash
#
# Start the Ship Route Planner: backend (FastAPI :8600) + frontend (Vite).
# Runs both in the background, tails their logs, and stops them on Ctrl+C.
#
set -euo pipefail

cd "$(dirname "$0")"

BACKEND_PORT="${BACKEND_PORT:-8600}"
BACKEND_LOG="${BACKEND_LOG:-/tmp/planner_api.log}"
FRONTEND_LOG="${FRONTEND_LOG:-/tmp/planner_vite.log}"

echo "== Ship Route Planner =="

# --- backend deps ----------------------------------------------------------
# The trained models need torch/joblib/scikit-learn/pandas/scipy. The sea-ice
# training venv already has them, so prefer it over building a second multi-GB
# environment. Without it the app still runs, but every model degrades to
# synthetic data -- silently, by design -- so say so loudly here instead.
MODEL_ROOT="${ICEBERG_MODEL_ROOT:-$(cd .. && pwd)}"
MODEL_VENV="${MODEL_VENV:-${MODEL_ROOT}/seaice_forecast/venv}"

if [ -x "${MODEL_VENV}/bin/python" ] && \
   "${MODEL_VENV}/bin/python" -c "import torch, joblib, sklearn, pandas, scipy" 2>/dev/null; then
  PY="${MODEL_VENV}/bin/python"
  echo "[backend] using model venv: ${MODEL_VENV}"
  "$PY" -c "import fastapi, uvicorn, shapely, pydantic" 2>/dev/null || {
    echo "[backend] installing web requirements into the model venv"
    "$PY" -m pip install --quiet -r backend/requirements.txt
  }
else
  echo "[backend] WARNING: no model-capable venv at ${MODEL_VENV}"
  echo "[backend]          starting WITHOUT the trained models (synthetic data)."
  echo "[backend]          to fix: pip install -r backend/requirements-models.txt"
  if [ ! -d backend/.venv ]; then
    echo "[backend] creating virtualenv .venv"
    python3 -m venv backend/.venv
  fi
  PY="$(pwd)/backend/.venv/bin/python"
  "$PY" -c "import fastapi, uvicorn, shapely, pydantic" 2>/dev/null || {
    echo "[backend] installing requirements"
    "$PY" -m pip install --quiet -r backend/requirements.txt
  }
fi
export ICEBERG_MODEL_ROOT="$MODEL_ROOT"

# macOS python.org builds ship without a wired-up CA bundle, so every
# Open-Meteo fetch in weather_engine dies with CERTIFICATE_VERIFY_FAILED and
# each sample silently degrades to a modeled estimate -- the route still
# renders, so nothing looks broken. Point OpenSSL at certifi instead.
if [ -z "${SSL_CERT_FILE:-}" ]; then
  CA_BUNDLE="$("$PY" -c 'import certifi; print(certifi.where())' 2>/dev/null || true)"
  if [ -n "$CA_BUNDLE" ] && [ -f "$CA_BUNDLE" ]; then
    export SSL_CERT_FILE="$CA_BUNDLE"
    export REQUESTS_CA_BUNDLE="$CA_BUNDLE"
  else
    echo "[backend] WARNING: no certifi CA bundle; live weather will fall back"
    echo "[backend]          to modeled estimates. Fix: $PY -m pip install certifi"
  fi
fi

# --- frontend deps ---------------------------------------------------------
if [ ! -d frontend/node_modules ]; then
  echo "[frontend] installing npm dependencies"
  npm --prefix frontend install --no-audit --no-fund
fi

cleanup() {
  echo ""
  echo "[stop] shutting down..."
  [ -n "${BE_PID:-}" ] && kill "$BE_PID" 2>/dev/null || true
  [ -n "${FE_PID:-}" ] && kill "$FE_PID" 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

# --- backend ---------------------------------------------------------------
echo "[backend] starting on 127.0.0.1:${BACKEND_PORT} (log: ${BACKEND_LOG})"
"$PY" -m uvicorn app.main:app --app-dir backend --port "$BACKEND_PORT" --host 127.0.0.1 > "$BACKEND_LOG" 2>&1 &
BE_PID=$!

# --- frontend --------------------------------------------------------------
# BACKEND_PORT must reach Vite: its /api proxy target is built from it, so a
# non-default backend port silently proxies to the wrong server without this.
echo "[frontend] starting Vite (log: ${FRONTEND_LOG})"
BACKEND_PORT="$BACKEND_PORT" npm --prefix frontend run dev > "$FRONTEND_LOG" 2>&1 &
FE_PID=$!

# --- wait for readiness ----------------------------------------------------
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${BACKEND_PORT}/api/health" > /dev/null 2>&1; then
    backend_up=1
    break
  fi
  sleep 0.5
done

# Vite picks the next free port when its default is taken, so read the port it
# actually reported rather than assuming one.
for _ in $(seq 1 60); do
  fe_port=$(grep -oE "localhost:[0-9]+" "$FRONTEND_LOG" 2>/dev/null | tail -1 | cut -d: -f2)
  if [ -n "$fe_port" ] && curl -fsS -o /dev/null "http://localhost:${fe_port}/" 2>/dev/null; then
    frontend_up=1
    break
  fi
  sleep 0.5
done

if [ -n "${backend_up:-}" ]; then
  echo "[backend]  ready at  http://127.0.0.1:${BACKEND_PORT}"
  status=$(curl -fsS "http://127.0.0.1:${BACKEND_PORT}/api/model-status" 2>/dev/null || echo "")
  case "$status" in
    *'"allLive":true'*) echo "[models]   LIVE — sea ice, iceberg drift, POLARIS risk" ;;
    *'"allLive":false'*) echo "[models]   DEGRADED — some models are synthetic; see ${BACKEND_LOG}" ;;
    *) echo "[models]   status unavailable" ;;
  esac
else
  echo "[backend]  did not become ready in time — see ${BACKEND_LOG}"
fi

if [ -n "${frontend_up:-}" ]; then
  echo "[frontend] ready at  http://localhost:${fe_port}"
else
  echo "[frontend] did not become ready in time — see ${FRONTEND_LOG}"
fi

echo ""
echo "Press Ctrl+C to stop both servers."

wait "$BE_PID" "$FE_PID"