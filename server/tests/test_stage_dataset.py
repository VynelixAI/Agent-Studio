"""
Unit tests for stage_dataset.py (columnar materialize + optional limit + spill).
Run from a materialized run dir or after extracting the module:

  cd server && python -c "
  from pathlib import Path
  import importlib.util, sys, tempfile, textwrap
  ..."

Or: copy buildStageDatasetPy output to /tmp/stage_dataset.py and:
  PYTHONPATH=/tmp pytest server/tests/test_stage_dataset.py -q
"""
from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


def _load_stage_dataset_module():
    """Load generated Python from the TypeScript source exporter via a sibling file if present,
    otherwise synthesize from the repo by writing the expected module path used in tests."""
    # Prefer already-generated file next to this test when materialize was run
    candidates = [
        Path(__file__).resolve().parents[1] / "src" / "codegen" / "_stage_dataset_fixture.py",
        Path(__file__).resolve().parent / "stage_dataset_under_test.py",
    ]
    for c in candidates:
        if c.exists():
            spec = importlib.util.spec_from_file_location("stage_dataset", c)
            assert spec and spec.loader
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod

    # Generate by shelling out to node to print the module (dev convenience)
    root = Path(__file__).resolve().parents[2]
    script = root / "server" / "scripts" / "emit_stage_dataset.py"
    # Fallback: read from a run's code if any
    runs = root / "data" / "runs"
    if runs.exists():
        for p in runs.rglob("stage_dataset.py"):
            spec = importlib.util.spec_from_file_location("stage_dataset", p)
            assert spec and spec.loader
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod

    raise unittest.SkipTest(
        "stage_dataset.py not found — run server tests after `node scripts/emit-stage-dataset.mjs`",
    )


class TestOptionalLimit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sd = _load_stage_dataset_module()

    def test_unset_means_all(self):
        self.assertIsNone(self.sd.optional_limit({}))
        self.assertIsNone(self.sd.optional_limit({"limit": None}))
        self.assertIsNone(self.sd.optional_limit({"limit": ""}))

    def test_explicit_limit(self):
        self.assertEqual(self.sd.optional_limit({"limit": 10}), 10)
        self.assertEqual(self.sd.optional_limit({"limit": "25"}), 25)


class TestMaterialize(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sd = _load_stage_dataset_module()

    def test_schema_and_rows_inline(self):
        rows = [
            {"_id": "1", "name": "Ada", "status": "active"},
            {"_id": "2", "name": "Bob", "status": "active"},
        ]
        with tempfile.TemporaryDirectory() as td:
            out = Path(td)
            ds = self.sd.materialize_tabular(
                rows=rows,
                query={
                    "mode": "collection",
                    "filter": {"status": "active"},
                    "projection": {"name": 1, "status": 1},
                    "limit": None,
                },
                outputs_dir=out,
                node_id="mongodb_read_1",
            )
        self.assertEqual(ds["kind"], "tabular")
        self.assertEqual(ds["rowCount"], 2)
        self.assertEqual(ds["storage"], "inline")
        self.assertEqual(ds["query"]["filter"], {"status": "active"})
        self.assertEqual(ds["query"]["projection"], {"name": 1, "status": 1})
        self.assertIsNone(ds["query"]["limit"])
        cols = [c["name"] for c in ds["schema"]["columns"]]
        self.assertIn("name", cols)
        self.assertIn("status", cols)
        self.assertEqual(len(ds["rows"]), 2)

    def test_spill_to_jsonl_when_over_row_cap(self):
        sd = self.sd
        # Temporarily lower thresholds
        old_rows, old_bytes = sd.INLINE_MAX_ROWS, sd.INLINE_MAX_BYTES
        sd.INLINE_MAX_ROWS = 3
        sd.INLINE_MAX_BYTES = 10**9
        try:
            rows = [{"_id": str(i), "v": i} for i in range(10)]
            with tempfile.TemporaryDirectory() as td:
                out = Path(td)
                # materialize expects outputs_dir; dataRef relative to parent (run root)
                # create fake run root layout: <root>/outputs
                run_root = out
                outputs = run_root / "outputs"
                outputs.mkdir()
                ds = sd.materialize_tabular(
                    rows=rows,
                    query={"mode": "collection", "filter": {}, "projection": None, "limit": None},
                    outputs_dir=outputs,
                    node_id="big_read",
                )
                self.assertIn(ds["storage"], ("jsonl", "parquet"))
                self.assertTrue(ds.get("dataRef"))
                self.assertEqual(ds["rowCount"], 10)
                # preview only
                self.assertLessEqual(len(ds["rows"]), 50)
        finally:
            sd.INLINE_MAX_ROWS = old_rows
            sd.INLINE_MAX_BYTES = old_bytes

    def test_rows_from_dataset_n8n_items_and_airflow_dags(self):
        sd = self.sd
        items = {
            "kind": "tabular",
            "storage": "inline",
            "rows": [{"dag_id": "etl_daily"}],
            "items": [{"json": {"dag_id": "etl_daily"}}],
            "json": {"dag_id": "etl_daily"},
            "text": "etl_daily",
        }
        self.assertEqual(sd.rows_from_dataset(items)[0]["dag_id"], "etl_daily")
        self.assertEqual(
            sd.rows_from_dataset({"items": [{"json": {"email": "a@b.com"}}]})[0]["email"],
            "a@b.com",
        )
        self.assertEqual(
            sd.rows_from_dataset(
                {"dags": [{"dag_id": "a"}, {"dag_id": "b"}]}
            )[1]["dag_id"],
            "b",
        )


if __name__ == "__main__":
    unittest.main()
