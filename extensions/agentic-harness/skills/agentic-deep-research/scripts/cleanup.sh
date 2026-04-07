#!/bin/bash
# cleanup.sh - Clean up deep research files

set -e

RUN_ID="${1:-}"
TARGET_DIR="${2:-.}"

if [ -z "$RUN_ID" ]; then
    echo "Usage: cleanup.sh <run_id> [target_dir]"
    echo "  run_id: Research run ID (e.g., 20260407)"
    echo "  target_dir: Directory containing research folder (default: .)"
    exit 1
fi

RESEARCH_DIR="${TARGET_DIR}/deep-research-${RUN_ID}"

if [ ! -d "$RESEARCH_DIR" ]; then
    echo "Research directory not found: ${RESEARCH_DIR}"
    exit 1
fi

# Close all browser sessions for this run
if [ -d "${RESEARCH_DIR}/sessions" ]; then
    for session in $(ls "${RESEARCH_DIR}/sessions/" 2>/dev/null || true); do
        agent-browser --session "${session}" close 2>/dev/null || true
    done
fi

# Remove research directory
rm -rf "${RESEARCH_DIR}"

echo "Cleaned up research run: ${RUN_ID} at ${RESEARCH_DIR}"
