#!/usr/bin/env python3
"""Backward-compatible alias: regenerate ES/FR/HT for Terms only."""
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "translate-legal-content.py"
sys.exit(subprocess.call([sys.executable, str(SCRIPT), "terms"]))
