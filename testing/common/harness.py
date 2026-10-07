"""
Shared harness for domain node tests.

Loads generated run_workflow.py from testing/_generated/code and provides
sandbox helpers (CSV → stage, invoke handlers, read outputs).
"""
from __future__ import annotations

import csv
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any

TESTING_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = TESTING_ROOT.parent
GENERATED_CODE = TESTING_ROOT / "_generated" / "code"


def ensure_codegen() -> Path:
    """Require emitted codegen; raise SkipTest with hint if missing."""
    runner = GENERATED_CODE / "run_workflow.py"
    stage = GENERATED_CODE / "stage_dataset.py"
    if runner.is_file() and stage.is_file():
        return GENERATED_CODE
    raise unittest.SkipTest(
        "Codegen not emitted. From repo root run:\n"
        "  npx tsx testing/scripts/emit_codegen.ts\n"
        "or: npm run test:domains:emit"
    )


def load_runner_module():
    code_dir = ensure_codegen()
    # Import under a unique name so domains don't clash
    sys.path.insert(0, str(code_dir))
    import importlib

    if "run_workflow" in sys.modules:
        del sys.modules["run_workflow"]
    if "stage_dataset" in sys.modules:
        del sys.modules["stage_dataset"]
    return importlib.import_module("run_workflow")


class DomainSandbox:
    """
    Temporary run root that mirrors a materialize layout:
      <root>/code/run_workflow.py  (copied)
      <root>/code/stage_dataset.py
      <root>/data/*.csv
      <root>/tasks.json
      <root>/secrets.local.json
      <root>/outputs/
    """

    def __init__(self, domain: str, keep: bool = False):
        self.domain = domain
        self.keep = keep
        self._tmpdir = tempfile.mkdtemp(prefix=f"as_{domain}_")
        self.root = Path(self._tmpdir)
        self.code = self.root / "code"
        self.data = self.root / "data"
        self.outputs = self.root / "outputs"
        self.logs = self.root / "logs"
        self.stage = self.code / "stage_cache"

    def __enter__(self) -> "DomainSandbox":
        code_src = ensure_codegen()
        self.code.mkdir(parents=True, exist_ok=True)
        for name in ("run_workflow.py", "stage_dataset.py", "studio_connectors.py"):
            src = code_src / name
            if src.is_file():
                shutil.copy2(src, self.code / name)
        self.data.mkdir(parents=True, exist_ok=True)
        self.outputs.mkdir(parents=True, exist_ok=True)
        self.logs.mkdir(parents=True, exist_ok=True)
        self.stage.mkdir(parents=True, exist_ok=True)
        (self.root / "approvals").mkdir(exist_ok=True)
        (self.root / "events").mkdir(exist_ok=True)
        # Point module ROOT at this sandbox by rewriting paths after import
        return self

    def __exit__(self, *exc) -> None:
        if not self.keep:
            shutil.rmtree(self.root, ignore_errors=True)

    def copy_data(self, src_dir: Path) -> None:
        if not src_dir.is_dir():
            return
        for p in src_dir.iterdir():
            if p.is_file():
                shutil.copy2(p, self.data / p.name)

    def write_tasks(self, tasks: dict[str, Any]) -> None:
        (self.root / "tasks.json").write_text(
            json.dumps(tasks, indent=2), encoding="utf-8"
        )

    def write_secrets(self, secrets: dict[str, Any]) -> None:
        (self.root / "secrets.local.json").write_text(
            json.dumps({"secrets": secrets}, indent=2), encoding="utf-8"
        )

    def import_runner(self):
        """Import run_workflow bound to this sandbox (ROOT = sandbox root)."""
        # Generated runner uses Path(__file__).parents[1] as ROOT → sandbox root
        sys.path.insert(0, str(self.code))
        for mod in ("run_workflow", "stage_dataset", "studio_connectors"):
            if mod in sys.modules:
                del sys.modules[mod]
        import importlib

        return importlib.import_module("run_workflow")

    def seed_stage_from_csv(
        self,
        stage_key: str,
        csv_name: str,
        *,
        limit: int | None = None,
    ) -> list[dict]:
        path = self.data / csv_name
        if not path.is_file():
            raise FileNotFoundError(path)
        rows: list[dict] = []
        with path.open(newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for i, row in enumerate(reader):
                if limit is not None and i >= limit:
                    break
                # coerce empty → None; numeric-ish → keep string for simplicity
                rows.append({k: (v if v != "" else None) for k, v in row.items()})
        rw = self.import_runner()
        dataset = rw.materialize_tabular(
            rows=rw.normalize_rows(rows),
            query={"mode": "csv", "path": csv_name},
            outputs_dir=self.outputs,
            node_id=f"seed_{stage_key.replace('.', '_')}",
            stage_key=stage_key,
        )
        # Also write stage cache JSON the way save_stage does
        rw.save_stage(stage_key, dataset)
        return rows

    def base_ctx(self, *, connectors: list | None = None) -> dict:
        tasks = {
            "run": {
                "workspace_id": f"ws_test_{self.domain}",
                "run_id": f"run_{self.domain}",
                "version": "test",
            },
            "connectors": connectors or [],
            "tasks": [],
            "edges": [],
            "secrets": [],
        }
        self.write_tasks(tasks)
        self.write_secrets({})
        return {
            "tasks": tasks,
            "secrets": {},
            "skip_ids": set(),
            "error_handlers": [],
            "halt": False,
        }


def read_csv_rows(path: Path, limit: int | None = None) -> list[dict]:
    rows: list[dict] = []
    with path.open(newline="", encoding="utf-8") as f:
        for i, row in enumerate(csv.DictReader(f)):
            if limit is not None and i >= limit:
                break
            rows.append(dict(row))
    return rows


def make_task(
    *,
    id: str,
    type: str,
    config: dict | None = None,
    inputs: list[str] | None = None,
    outputs: list[str] | None = None,
    connector: str | None = None,
    name: str | None = None,
) -> dict:
    return {
        "id": id,
        "name": name or id,
        "type": type,
        "category": "test",
        "connector": connector,
        "inputs": inputs or [],
        "outputs": outputs or [f"stage.{id}"],
        "config": config or {},
        "depends_on": [],
    }
