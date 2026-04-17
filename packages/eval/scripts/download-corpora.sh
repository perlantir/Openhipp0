#!/usr/bin/env bash
# Download + verify the four eval corpora into $HIPP0_EVAL_CORPUS_DIR.
#
#   tau-bench         (sierra-research/tau-bench, Apache 2.0)
#   swe-bench-lite    (princeton-nlp/SWE-bench_Lite, MIT)
#   gaia              (huggingface.co/datasets/gaia-benchmark/GAIA, CC-BY)
#   agentbench        (THUDM/AgentBench, Apache 2.0)
#
# Requires: git, jq, (optionally) huggingface-cli for GAIA.
# Usage: HIPP0_EVAL_CORPUS_DIR=~/hipp0-eval-corpora bash download-corpora.sh

set -euo pipefail

CORPUS_DIR="${HIPP0_EVAL_CORPUS_DIR:-$HOME/hipp0-eval-corpora}"
mkdir -p "$CORPUS_DIR"
echo "Installing corpora under: $CORPUS_DIR"

# ─── τ-bench ────────────────────────────────────────────────────────────────
if [ ! -d "$CORPUS_DIR/tau-bench/.git" ]; then
  echo "[1/4] tau-bench — cloning sierra-research/tau-bench"
  git clone --depth 1 https://github.com/sierra-research/tau-bench.git "$CORPUS_DIR/tau-bench"
else
  echo "[1/4] tau-bench — present, fetching"
  git -C "$CORPUS_DIR/tau-bench" pull --ff-only || true
fi

# ─── SWE-bench Lite ────────────────────────────────────────────────────────
SWE_DIR="$CORPUS_DIR/swe-bench-lite"
if [ ! -d "$SWE_DIR" ]; then
  echo "[2/4] SWE-bench Lite — downloading from HuggingFace"
  mkdir -p "$SWE_DIR/test"
  # 300-instance test split as JSONL (lightweight subset).
  curl -fsSL "https://huggingface.co/datasets/princeton-nlp/SWE-bench_Lite/resolve/main/data/test-00000-of-00001.parquet" \
    -o "$SWE_DIR/test.parquet" || echo "SWE-bench Lite download failed — fetch manually and rerun."
  echo "  → parquet at $SWE_DIR/test.parquet; convert to JSONL with the separate converter."
else
  echo "[2/4] SWE-bench Lite — present"
fi

# ─── GAIA ──────────────────────────────────────────────────────────────────
GAIA_DIR="$CORPUS_DIR/gaia"
if [ ! -d "$GAIA_DIR" ]; then
  echo "[3/4] GAIA — requires huggingface-cli + HF auth (dataset is gated)"
  if command -v huggingface-cli >/dev/null; then
    mkdir -p "$GAIA_DIR"
    huggingface-cli download gaia-benchmark/GAIA --repo-type dataset --local-dir "$GAIA_DIR" --include "*.json" || true
  else
    echo "  → huggingface-cli not found; install with \`pip install huggingface_hub\` and re-run."
    echo "  → Or fetch manually: https://huggingface.co/datasets/gaia-benchmark/GAIA"
    mkdir -p "$GAIA_DIR"
  fi
else
  echo "[3/4] GAIA — present"
fi

# ─── AgentBench ────────────────────────────────────────────────────────────
AB_DIR="$CORPUS_DIR/agentbench"
if [ ! -d "$AB_DIR/.git" ]; then
  echo "[4/4] AgentBench — cloning THUDM/AgentBench"
  git clone --depth 1 https://github.com/THUDM/AgentBench.git "$AB_DIR"
else
  echo "[4/4] AgentBench — present, fetching"
  git -C "$AB_DIR" pull --ff-only || true
fi

echo
echo "Done. Set HIPP0_EVAL_CORPUS_DIR=$CORPUS_DIR in your env."
echo "Run: pnpm --filter @openhipp0/eval run:regression"
