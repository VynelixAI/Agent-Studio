/**
 * Shared Python helpers embedded into notebook / code-lab runs
 * so cells can fetch via workspace connectors + secrets.
 */
export function buildStudioConnectorsPy(): string {
  return `"""Agent Studio — connector helpers for notebooks / code lab."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1] if (Path(__file__).name == "studio_connectors.py") else Path(".").resolve()
# When imported from code/, ROOT is the run folder
if (Path(__file__).resolve().parent.name == "code"):
    ROOT = Path(__file__).resolve().parents[1]

TASKS_YAML = ROOT / "tasks.yaml"
TASKS_JSON = ROOT / "tasks.json"
SECRETS_YAML = ROOT / "secrets.local.yaml"
SECRETS_JSON = ROOT / "secrets.local.json"
DOCUMENT_JSON = ROOT / "document.json"


def _load_yaml_or_json(path_yaml: Path, path_json: Path) -> dict:
    if path_json.exists():
        return json.loads(path_json.read_text(encoding="utf-8"))
    if path_yaml.exists():
        try:
            import yaml  # type: ignore
            return yaml.safe_load(path_yaml.read_text(encoding="utf-8")) or {}
        except Exception:
            return {}
    return {}


def load_tasks() -> dict:
    doc = _load_yaml_or_json(TASKS_YAML, TASKS_JSON)
    if doc:
        return doc
    if DOCUMENT_JSON.exists():
        d = json.loads(DOCUMENT_JSON.read_text(encoding="utf-8"))
        return {
            "connectors": [
                {
                    "id": c.get("id"),
                    "type": c.get("type"),
                    "label": c.get("label"),
                    "secret_ref": c.get("secretRef") or c.get("secret_ref"),
                    "config": c.get("config") or {},
                }
                for c in d.get("connectors") or []
            ],
            "tasks": [],
            "run": {"workspace_id": (d.get("workspace") or {}).get("id")},
        }
    return {"connectors": [], "tasks": [], "run": {}}


def load_secrets() -> dict:
    if SECRETS_JSON.exists():
        return (json.loads(SECRETS_JSON.read_text(encoding="utf-8")).get("secrets")) or {}
    if SECRETS_YAML.exists():
        try:
            import yaml  # type: ignore
            return (yaml.safe_load(SECRETS_YAML.read_text(encoding="utf-8")) or {}).get("secrets") or {}
        except Exception:
            return {}
    return {}


def list_connectors() -> list[dict]:
    return list(load_tasks().get("connectors") or [])


def get_connector(connector_id: str | None = None, connector_type: str | None = None) -> dict | None:
    connectors = list_connectors()
    if connector_id:
        for c in connectors:
            if c.get("id") == connector_id:
                return c
    if connector_type:
        for c in connectors:
            if c.get("type") == connector_type or str(c.get("id") or "").startswith(connector_type):
                return c
    return connectors[0] if len(connectors) == 1 else None


def parse_secret_blob(raw: Any) -> dict:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    text = str(raw).strip()
    if not text:
        return {}
    if text.startswith("{") or text.startswith("["):
        try:
            parsed = json.loads(text)
            return parsed if isinstance(parsed, dict) else {"value": parsed}
        except Exception:
            return {"value": text}
    return {"uri": text, "apiKey": text, "password": text}


def resolve_secret(secret_ref: str | None) -> Any:
    if not secret_ref:
        return None
    secrets = load_secrets()
    if secret_ref in secrets:
        return secrets[secret_ref]
    bare = secret_ref.replace("secret://", "")
    return secrets.get(bare) or secrets.get(f"secret://{bare}")


def mongo_uri_from_connector(connector: dict | None) -> str | None:
    if not connector:
        return None
    cfg = connector.get("config") or {}
    blob = parse_secret_blob(resolve_secret(connector.get("secret_ref")))
    uri = (
        blob.get("uri")
        or blob.get("connectionString")
        or cfg.get("uri")
        or cfg.get("connectionString")
    )
    if uri:
        return str(uri)
    # Compose from parts when present
    host = cfg.get("host") or "127.0.0.1"
    port = cfg.get("port") or 27017
    user = blob.get("username") or cfg.get("username")
    password = blob.get("password") or cfg.get("password")
    db = cfg.get("database") or "ops"
    if user and password:
        return f"mongodb://{user}:{password}@{host}:{port}/{db}"
    return f"mongodb://{host}:{port}/{db}"


def fetch_mongodb(
    collection: str,
    *,
    connector_id: str | None = None,
    database: str | None = None,
    filter: dict | None = None,
    projection: dict | None = None,
    sort: dict | None = None,
    limit: int | None = None,
    fallback_docs: list | None = None,
) -> list:
    """
    Fetch documents via the workspace MongoDB connector.
    Default: ALL matching rows (no limit). Pass limit=N only to cap.
    Filter then projection on the server/driver. Falls back to fallback_docs when offline.
    """
    connector = get_connector(connector_id=connector_id, connector_type="mongodb")
    cfg = (connector or {}).get("config") or {}
    db_name = database or cfg.get("database") or "ops"
    uri = mongo_uri_from_connector(connector)
    try:
        from pymongo import MongoClient  # type: ignore
        client = MongoClient(uri, serverSelectionTimeoutMS=4000)
        client.admin.command("ping")
        coll = client[db_name][collection]
        cursor = coll.find(filter or {}, projection if projection else None)
        if sort:
            cursor = cursor.sort(list(sort.items()))
        if limit is not None and int(limit) > 0:
            cursor = cursor.limit(int(limit))
        docs = list(cursor)
        for d in docs:
            if "_id" in d:
                d["_id"] = str(d["_id"])
        print(
            f"mongodb ok · {db_name}.{collection} · rows={len(docs)} · "
            f"filter={bool(filter)} projection={bool(projection)} limit={limit} · "
            f"connector={(connector or {}).get('id')}"
        )
        return docs
    except Exception as exc:  # noqa: BLE001
        print(f"mongodb live fetch skipped ({exc})")
        docs = list(fallback_docs or [])
        print(f"using fallback sample · rows={len(docs)}")
        return docs


def write_s3_json(
    obj: Any,
    *,
    key: str,
    connector_id: str | None = None,
    bucket: str | None = None,
) -> dict:
    """Upload JSON via S3 connector. Requires accessKeyId + secretAccessKey in secret/config/env."""
    import os

    connector = get_connector(connector_id=connector_id, connector_type="s3")
    cfg = (connector or {}).get("config") or {}
    blob = parse_secret_blob(resolve_secret((connector or {}).get("secret_ref")))

    def _first(*vals: Any) -> str:
        for v in vals:
            if v is None:
                continue
            s = str(v).strip()
            if s:
                return s
        return ""

    access = _first(
        blob.get("accessKeyId"),
        blob.get("aws_access_key_id"),
        blob.get("access_key"),
        cfg.get("accessKeyId"),
        os.environ.get("AWS_ACCESS_KEY_ID"),
    )
    secret = _first(
        blob.get("secretAccessKey"),
        blob.get("aws_secret_access_key"),
        blob.get("secret_key"),
        cfg.get("secretAccessKey"),
        os.environ.get("AWS_SECRET_ACCESS_KEY"),
    )
    session_token = _first(
        blob.get("sessionToken"),
        blob.get("aws_session_token"),
        cfg.get("sessionToken"),
        os.environ.get("AWS_SESSION_TOKEN"),
    ) or None
    region = _first(cfg.get("region"), blob.get("region"), os.environ.get("AWS_DEFAULT_REGION"), "us-east-1")
    endpoint = _first(cfg.get("endpoint"), blob.get("endpoint")) or None
    bucket_name = bucket or cfg.get("bucket") or "de-demo-lake"
    prefix = str(cfg.get("prefix") or "")
    full_key = key
    if prefix and not key.startswith(prefix):
        full_key = f"{prefix.rstrip('/')}/{key.lstrip('/')}"
    body = json.dumps(obj, indent=2, default=str).encode("utf-8")
    local = ROOT / "outputs" / "s3" / bucket_name / full_key
    local.parent.mkdir(parents=True, exist_ok=True)
    local.write_bytes(body)
    if not access or not secret:
        raise RuntimeError(
            "S3 credentials missing — set Access key ID + Secret access key on the S3 connector"
        )
    import boto3  # type: ignore
    from botocore.client import Config as BotoConfig  # type: ignore

    client_kwargs: dict[str, Any] = {
        "region_name": region,
        "aws_access_key_id": access,
        "aws_secret_access_key": secret,
    }
    if session_token:
        client_kwargs["aws_session_token"] = session_token
    if endpoint:
        client_kwargs["endpoint_url"] = endpoint
        client_kwargs["config"] = BotoConfig(s3={"addressing_style": "path"})
    client = boto3.client("s3", **client_kwargs)
    client.put_object(
        Bucket=bucket_name,
        Key=full_key,
        Body=body,
        ContentType="application/json",
    )
    result = {
        "uri": f"s3://{bucket_name}/{full_key}",
        "uploaded": True,
        "live": True,
        "demoMode": False,
        "localArtifact": str(local),
        "connector": (connector or {}).get("id"),
    }
    print(result)
    return result


__all__ = [
    "list_connectors",
    "get_connector",
    "fetch_mongodb",
    "write_s3_json",
    "load_tasks",
    "load_secrets",
]
`;
}
