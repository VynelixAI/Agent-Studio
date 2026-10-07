#!/usr/bin/env python3
"""
Run all Agent Studio domain node tests.

  # 1) Emit generated Python handlers
  npx tsx testing/scripts/emit_codegen.ts

  # 2) Run everything
  python3 testing/run_all.py

  # Or one domain:
  python3 -m unittest testing.basics.test_basics -v
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

DOMAINS = [
    "testing.basics.test_basics",
    "testing.control_workflow.test_control",
    "testing.databases.test_databases",
    "testing.data_engineering.test_data_engineering",
    "testing.data_engineering.test_de_plugin_fixes",
    "testing.automation.test_automation",
    "testing.ai_communication.test_ai_communication",
]


def main() -> int:
    gen = REPO / "testing" / "_generated" / "code" / "run_workflow.py"
    if not gen.is_file():
        print(
            "Missing codegen. Run first:\n"
            "  npx tsx testing/scripts/emit_codegen.ts\n",
            file=sys.stderr,
        )
        return 2

    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    for name in DOMAINS:
        suite.addTests(loader.loadTestsFromName(name))

    result = unittest.TextTestRunner(verbosity=2).run(suite)
    print(
        f"\nSummary: ran={result.testsRun} "
        f"failures={len(result.failures)} errors={len(result.errors)} "
        f"skipped={len(result.skipped)}"
    )
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
