#!/usr/bin/env bash
# setup.sh — Bootstrap the 6 isolated specialist agents on the current host.
#
# Prerequisites:
#   - OpenClaw installed and gateway running
#   - A working default model with auth (this script uses ollama/kimi-k2.6:cloud
#     for text specialists and ollama/kimi-k2.5:cloud for vision-agent;
#     override via env vars below if you use a different provider)
#
# What this does:
#   1. Runs `openclaw agents add <id>` for each specialist
#   2. Overlays this repo's AGENTS.md into each specialist's workspace
#   3. Removes the auto-generated BOOTSTRAP.md (specialists have a pre-defined identity)
#   4. Prints next steps
#
# What this does NOT do:
#   - Populate the specialist IDENTITY.md (you fill those in from the .template files)
#   - Configure Linear integration (separate optional step — see orchestrator/LINEAR.md)
#   - Restart the gateway (we suggest you do that after personalization)
#
# Re-runnable: skips agents that already exist.

set -euo pipefail

# --- Configuration (override via env) ---
TEXT_MODEL="${OPENCLAW_ORCHESTRA_TEXT_MODEL:-ollama/kimi-k2.6:cloud}"
VISION_MODEL="${OPENCLAW_ORCHESTRA_VISION_MODEL:-ollama/kimi-k2.5:cloud}"
OPENCLAW_AGENTS_BASE="${OPENCLAW_AGENTS_BASE:-$HOME/.openclaw/agents}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

declare -A AGENT_MODELS=(
  [system-agent]="$TEXT_MODEL"
  [code-agent]="$TEXT_MODEL"
  [research-agent]="$TEXT_MODEL"
  [data-agent]="$TEXT_MODEL"
  [comm-agent]="$TEXT_MODEL"
  [vision-agent]="$VISION_MODEL"
)

# --- Pre-flight ---
command -v openclaw >/dev/null || { echo "ERROR: openclaw not on PATH" >&2; exit 1; }
[ -d "$REPO_ROOT/agents" ] || { echo "ERROR: cannot find agents/ in repo at $REPO_ROOT" >&2; exit 1; }

echo "openclaw-hawkins setup — creating 6 specialist agents under $OPENCLAW_AGENTS_BASE"
echo "  text-model:   $TEXT_MODEL"
echo "  vision-model: $VISION_MODEL"
echo

# --- Create each agent ---
for agent_id in "${!AGENT_MODELS[@]}"; do
  model="${AGENT_MODELS[$agent_id]}"
  workspace="$OPENCLAW_AGENTS_BASE/$agent_id/workspace"

  if [ -d "$workspace" ]; then
    echo "skip   $agent_id (workspace exists at $workspace)"
  else
    echo "create $agent_id (model: $model)"
    openclaw agents add "$agent_id" \
      --non-interactive \
      --model "$model" \
      --workspace "$workspace" >/dev/null
  fi

  # Overlay this repo's AGENTS.md
  src_agents="$REPO_ROOT/agents/$agent_id/AGENTS.md"
  if [ -f "$src_agents" ]; then
    cp "$src_agents" "$workspace/AGENTS.md"
    echo "       overlaid AGENTS.md"
  fi

  # Drop the auto-generated BOOTSTRAP.md (specialist has a pre-defined identity)
  rm -f "$workspace/BOOTSTRAP.md"
done

echo
echo "Done."
echo
echo "Next steps:"
echo "  1. Personalize each specialist's IDENTITY.md from the .template:"
for agent_id in "${!AGENT_MODELS[@]}"; do
  echo "       cp $REPO_ROOT/agents/$agent_id/IDENTITY.md.template $OPENCLAW_AGENTS_BASE/$agent_id/workspace/IDENTITY.md"
done
echo "     Then edit each to fill in your name + host."
echo
echo "  2. Install the orchestrator workspace files:"
echo "       cp $REPO_ROOT/orchestrator/AGENTS.md ~/.openclaw/workspace/AGENTS.md"
echo "       cp $REPO_ROOT/orchestrator/TOOLS.md.template ~/.openclaw/workspace/TOOLS.md   # then edit"
echo "       cp $REPO_ROOT/orchestrator/IDENTITY.md.template ~/.openclaw/workspace/IDENTITY.md   # then edit"
echo
echo "  3. (Optional) Wire Linear ticket oversight — see orchestrator/LINEAR.md"
echo
echo "  4. Restart the gateway: openclaw gateway restart"
echo
echo "  5. Smoke-test:"
echo "       openclaw agent --agent system-agent --message \"Introduce yourself in one line.\" --json --timeout 30"
