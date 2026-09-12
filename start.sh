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
if [ ! -d backend/.venv ]; then
  echo "[backend] creating virtualenv .venv"
  python3 -m venv backend/.venv
fi
source backend/.venv/bin/activate
python -c "import fastapi, uvicorn, shapely, pydantic" 2>/dev/null || {
  echo "[backend] installing requirements"
  pip install --quiet -r backend/requirements.txt
}

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
python -m uvicorn app.main:app --app-dir backend --port "$BACKEND_PORT" --host 127.0.0.1 > "$BACKEND_LOG" 2>&1 &
BE_PID=$!

# --- frontend --------------------------------------------------------------
echo "[frontend] starting Vite (log: ${FRONTEND_LOG})"
npm --prefix frontend run dev > "$FRONTEND_LOG" 2>&1 &
FE_PID=$!

# --- wait for readiness ----------------------------------------------------
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${BACKEND_PORT}/api/health" > /dev/null 2>&1; then
    backend_up=1
    break
  fi
  sleep 0.5
done

for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null http://localhost:5174/ 2>/dev/null || curl -fsS -o /dev/null http://127.0.0.1:5174/ 2>/dev/null; then
    frontend_up=1
    break
  fi
  sleep 0.5
done

if [ -n "${backend_up:-}" ]; then
  echo "[backend]  ready at  http://127.0.0.1:${BACKEND_PORT}"
else
  echo "[backend]  did not become ready in time — see ${BACKEND_LOG}"
fi

if [ -n "${frontend_up:-}" ]; then
  port=$(grep -oE "localhost:[0-9]+" "$FRONTEND_LOG" | tail -1 | cut -d: -f2)
  echo "[frontend] ready at  http://localhost:${port:-5174}"
else
  echo "[frontend] did not become ready in time — see ${FRONTEND_LOG}"
fi

echo ""
echo "Press Ctrl+C to stop both servers."

wait "$BE_PID" "$FE_PID"