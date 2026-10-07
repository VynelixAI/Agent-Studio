/**
 * Python helpers for columnar stage datasets + spill.
 * Written to each run as code/stage_dataset.py and imported by run_workflow.py.
 */
export function buildStageDatasetPy(): string {
  return `"""
Agent Studio — columnar stage datasets for DB / notebook / logic handover.
Filter → projection → materialize. Optional limit only when explicitly set.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Spill thresholds (safety, not a default row cap)
INLINE_MAX_ROWS = 5_000
INLINE_MAX_BYTES = 4 * 1024 * 1024  # 4 MiB


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_jsonish(value: Any, default: Any = None) -> Any:
    if value is None or value == "":
        return default
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return default
        try:
            return json.loads(text)
        except Exception:  # noqa: BLE001
            return default
    return value


def optional_limit(cfg: dict) -> int | None:
    """Return int limit only when user explicitly set a positive number."""
    if "limit" not in cfg:
        return None
    raw = cfg.get("limit")
    if raw is None or raw == "":
        return None
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return None
    if n <= 0:
        return None
    return n


def infer_dtype(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int) and not isinstance(value, bool):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, (list, tuple)):
        return "array"
    if isinstance(value, dict):
        return "object"
    return "string"


def flatten_doc(doc: dict, prefix: str = "") -> dict:
    """Shallow-friendly flatten for columnar preview (dot keys for nested objects)."""
    out: dict[str, Any] = {}
    for k, v in (doc or {}).items():
        key = f"{prefix}{k}" if not prefix else f"{prefix}.{k}"
        if isinstance(v, dict) and v and not any(isinstance(x, (dict, list)) for x in v.values()):
            for sk, sv in v.items():
                out[f"{key}.{sk}"] = sv
        else:
            out[key] = v
    return out


def build_columns(rows: list[dict]) -> list[dict]:
    order: list[str] = []
    seen: set[str] = set()
    dtypes: dict[str, str] = {}
    for row in rows:
        flat = flatten_doc(row) if isinstance(row, dict) else {"value": row}
        for name, val in flat.items():
            if name not in seen:
                seen.add(name)
                order.append(name)
                dtypes[name] = infer_dtype(val)
            elif dtypes.get(name) == "null" and val is not None:
                dtypes[name] = infer_dtype(val)
    return [{"name": n, "dtype": dtypes.get(n, "string")} for n in order]


def normalize_rows(docs: list[Any]) -> list[dict]:
    rows: list[dict] = []
    for d in docs:
        if isinstance(d, dict):
            row = dict(d)
            if "_id" in row:
                row["_id"] = str(row["_id"])
            rows.append(row)
        else:
            rows.append({"value": d})
    return rows


def estimate_bytes(rows: list[dict]) -> int:
    try:
        return len(json.dumps(rows, default=str).encode("utf-8"))
    except Exception:  # noqa: BLE001
        return len(rows) * 256


def materialize_tabular(
    *,
    rows: list[dict],
    query: dict,
    outputs_dir: Path,
    node_id: str,
    stage_key: str | None = None,
) -> dict:
    """
    Build columnar dataset. Spill to parquet (or jsonl) when over INLINE_MAX_*.
    """
    columns = build_columns(rows)
    row_count = len(rows)
    nbytes = estimate_bytes(rows)
    storage = "inline"
    data_ref = None
    inline_rows: list[dict] | None = rows

    if row_count > INLINE_MAX_ROWS or nbytes > INLINE_MAX_BYTES:
        sidecars = outputs_dir / "sidecars"
        sidecars.mkdir(parents=True, exist_ok=True)
        base = sidecars / f"{node_id}"
        parquet_path = base.with_suffix(".parquet")
        jsonl_path = base.with_suffix(".jsonl")
        spilled = False
        try:
            import pandas as pd  # type: ignore

            df = pd.json_normalize(rows)
            try:
                df.to_parquet(parquet_path, index=False)
                storage = "parquet"
                data_ref = str(parquet_path.relative_to(outputs_dir.parent))
                spilled = True
            except Exception:  # noqa: BLE001
                pass
        except Exception:  # noqa: BLE001
            pass
        if not spilled:
            with jsonl_path.open("w", encoding="utf-8") as f:
                for r in rows:
                    f.write(json.dumps(r, default=str) + "\\n")
            storage = "jsonl"
            data_ref = str(jsonl_path.relative_to(outputs_dir.parent))
        inline_rows = rows[:50]  # preview only when spilled

    dataset = {
        "kind": "tabular",
        "schema": {"columns": columns},
        "rowCount": row_count,
        "storage": storage,
        "query": query,
        "updated_at": utc_now(),
    }
    if stage_key:
        dataset["stageKey"] = stage_key
    if data_ref:
        dataset["dataRef"] = data_ref
        dataset["previewRows"] = inline_rows
        dataset["rows"] = inline_rows  # preview alias for consumers
    else:
        dataset["rows"] = inline_rows
    return dataset


def _row_dict(x: Any) -> dict:
    """Unwrap an n8n item {json, binary} or pass a plain dict through."""
    if isinstance(x, dict):
        inner = x.get("json")
        extra = set(x.keys()) - {"json", "binary", "pairedItem", "paired_item"}
        if isinstance(inner, dict) and not extra:
            return dict(inner)
        return dict(x)
    if x is None:
        return {}
    return {"value": x}


def rows_from_dataset(data: Any) -> list[dict]:
    """Extract row list from a stage payload (tabular, n8n items, or legacy)."""
    if data is None:
        return []
    if isinstance(data, list):
        return normalize_rows([_row_dict(x) for x in data])
    if not isinstance(data, dict):
        return []
    if data.get("kind") == "tabular":
        if data.get("storage") in ("parquet", "jsonl") and data.get("dataRef"):
            ref = Path(str(data["dataRef"]))
            return _load_sidecar(ref, data)
        got = data.get("rows") or data.get("previewRows") or []
        if got:
            return normalize_rows([_row_dict(x) for x in got])
    items = data.get("items")
    if isinstance(items, list) and items:
        out = [_row_dict(it) for it in items]
        if out:
            return normalize_rows(out)
    if isinstance(data.get("rows"), list) and data["rows"]:
        return normalize_rows([_row_dict(x) for x in data["rows"]])
    if isinstance(data.get("json"), list) and data["json"]:
        return normalize_rows([_row_dict(x) for x in data["json"]])
    if isinstance(data.get("json"), dict) and data.get("json"):
        return normalize_rows([data["json"]])
    for key in (
        "dags", "deployments", "matched", "jobs", "files", "records",
        "connections", "sources", "destinations", "workflows", "assets",
        "tables", "hits", "events", "work_pools", "xcomEntries",
        "variables", "dag_runs", "flow_runs", "applications",
    ):
        val = data.get(key)
        if isinstance(val, list) and val:
            return normalize_rows([_row_dict(x) for x in val])
        if isinstance(val, dict):
            inner = val.get("hits") or val.get("results") or val.get("items")
            if isinstance(inner, list) and inner:
                return normalize_rows([_row_dict(x) for x in inner])
    if isinstance(data.get("result"), dict) and isinstance(data["result"].get("rows"), list):
        return normalize_rows([_row_dict(x) for x in data["result"]["rows"]])
    skip = {
        "schema", "query", "previewRows", "dataRef", "storage", "kind",
        "items", "handover", "json", "text", "summary", "outputFiles",
    }
    row = {k: v for k, v in data.items() if k not in skip}
    return [row] if row else []


def _load_sidecar(ref: Path, data: dict) -> list[dict]:
    # Caller may pass relative path; resolve against common roots
    candidates = [ref]
    if not ref.is_absolute():
        here = Path(__file__).resolve().parent
        candidates.extend(
            [
                here.parent / ref,
                here / ref,
            ]
        )
    for path in candidates:
        if not path.exists():
            continue
        if path.suffix == ".parquet":
            try:
                import pandas as pd  # type: ignore

                return normalize_rows(pd.read_parquet(path).to_dict(orient="records"))
            except Exception:  # noqa: BLE001
                continue
        if path.suffix == ".jsonl":
            rows = []
            with path.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        rows.append(json.loads(line))
            return normalize_rows(rows)
    return normalize_rows(data.get("previewRows") or data.get("rows") or [])


def dataset_to_dataframe(data: Any):
    """Return a pandas DataFrame for notebook / logic nodes."""
    import pandas as pd  # type: ignore

    return pd.DataFrame(rows_from_dataset(data))
`;
}
