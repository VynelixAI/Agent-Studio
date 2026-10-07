/**
 * Live handlers for data-engineering plugin families that used to hit handle_default.
 * Concatenated into the generated Python runner.
 */
export function buildDePluginHandlersPy(): string {
  return `
def _connector_bundle(task: dict, ctx: dict) -> tuple[dict | None, dict, dict, dict]:
    connector = get_connector(ctx["tasks"], task.get("connector"))
    conn_cfg = (connector or {}).get("config") or {}
    cfg = {**conn_cfg, **_flatten_node_config(task.get("config") or {})}
    blob = parse_secret_blob(
        resolve_secret(ctx["tasks"], ctx["secrets"], (connector or {}).get("secret_ref"))
    )
    return connector, conn_cfg, blob, cfg


def _http_auth_headers(blob: dict, cfg: dict) -> dict:
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    extra = parse_jsonish(cfg.get("headers"), default=None)
    if isinstance(extra, dict):
        headers.update({str(k): str(v) for k, v in extra.items()})
    user = blob.get("username") or cfg.get("username")
    password = blob.get("password") or cfg.get("password")
    token = (
        blob.get("token")
        or blob.get("apiKey")
        or blob.get("accessToken")
        or cfg.get("token")
        or cfg.get("apiKey")
        # a lone password (no username) is a token field, e.g. Flink "Password / token"
        or (None if user else blob.get("password"))
    )
    if token:
        headers["Authorization"] = (
            token if str(token).lower().startswith("bearer ") else f"Bearer {token}"
        )
    elif user:
        import base64

        raw = base64.b64encode(f"{user}:{password or ''}".encode("utf-8")).decode("ascii")
        headers["Authorization"] = f"Basic {raw}"
    return headers


def _tls_context(cfg: dict, url: str) -> Any:
    """SSL context for HTTPS products (NiFi ships a self-signed cert by default).

    verifySsl=false or a caCertPath opts in explicitly; when unset, loopback hosts
    skip verification so a local single-user NiFi works out of the box.
    """
    import ssl

    if not str(url).lower().startswith("https://"):
        return None
    ca_path = str(cfg.get("caCertPath") or cfg.get("caCert") or "").strip()
    if ca_path:
        return ssl.create_default_context(cafile=ca_path)
    raw = cfg.get("verifySsl")
    if raw is None or str(raw).strip() == "":
        host = urllib.parse.urlparse(url).hostname or ""
        verify = host not in ("localhost", "127.0.0.1", "::1")
    else:
        verify = str(raw).strip().lower() not in ("false", "0", "no", "off")
    if verify:
        return ssl.create_default_context()
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _connector_base_url(cfg: dict, default: str = "") -> str:
    url = str(
        cfg.get("baseUrl")
        or cfg.get("restUrl")
        or cfg.get("graphqlUrl")
        or cfg.get("url")
        or cfg.get("host")
        or cfg.get("endpoint")
        or cfg.get("apiUrl")
        or default
        or ""
    ).strip()
    if url and not url.startswith(("http://", "https://")) and "://" not in url:
        url = "http://" + url
    return url.rstrip("/")


def _emit_plugin(task: dict, payload: dict) -> dict:
    cfg = _flatten_node_config(task.get("config") or {})
    rows = payload.get("rows")
    if not isinstance(rows, list) or not rows:
        rows = _extract_item_rows(payload)
    if not rows:
        rows = [payload] if payload else []
    dataset = materialize_tabular(
        rows=normalize_rows(rows),
        query={"mode": "plugin", "op": task.get("type")},
        outputs_dir=OUTPUTS,
        node_id=str(task.get("id") or task.get("type") or "plugin"),
        stage_key=_task_stage_keys(task)[0],
    )
    for k, v in payload.items():
        if k not in dataset:
            dataset[k] = v
    dataset["ok"] = bool(payload.get("ok", True))
    dataset["op"] = task.get("type")
    dataset["live"] = bool(payload.get("ok", True)) and not payload.get("error")
    dataset = _attach_item_contract(dataset, dataset.get("rows") or rows)
    return emit_task_outputs({**task, "config": cfg}, dataset)


def handle_redis(task: dict, ctx: dict) -> dict:
    try:
        import redis  # type: ignore
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"redis package is required for redis.* nodes: {exc}") from exc
    _conn, _cc, blob, cfg = _connector_bundle(task, ctx)
    uri = blob.get("uri") or blob.get("url") or cfg.get("uri") or cfg.get("url")
    if uri:
        client = redis.Redis.from_url(str(uri), decode_responses=True)
    else:
        redis_kwargs: dict[str, Any] = {
            "host": str(cfg.get("host") or "127.0.0.1"),
            "port": int(cfg.get("port") or 6379),
            "password": blob.get("password") or cfg.get("password") or None,
            "db": int(cfg.get("database") or cfg.get("db") or 0),
            "decode_responses": True,
        }
        acl_user = blob.get("username") or cfg.get("username")
        if acl_user:
            redis_kwargs["username"] = str(acl_user)  # Redis 6+ ACL users
        try:
            client = redis.Redis(**redis_kwargs)
        except TypeError:
            # redis-py < 3.5 has no username kwarg
            redis_kwargs.pop("username", None)
            client = redis.Redis(**redis_kwargs)

    def _redis_value(v: Any) -> Any:
        # redis-py 3+ rejects bool / dict / list / None (2.x silently str()-ed them)
        if isinstance(v, (str, bytes, float)) or (isinstance(v, int) and not isinstance(v, bool)):
            return v
        return json.dumps(v, default=str)

    t = str(task.get("type") or "")
    key = str(cfg.get("target") or cfg.get("key") or cfg.get("resourceName") or "")
    rows_in = _rows_from_task_inputs(task)
    if t.endswith(".get"):
        keys = [key] if key else [str(r.get("key") or r.get("id") or "") for r in rows_in]
        keys = [k for k in keys if k]
        vals = client.mget(keys) if keys else []
        rows = [{"key": k, "value": v} for k, v in zip(keys, vals)]
        return _emit_plugin(task, {"ok": True, "op": t, "rows": rows})
    if t.endswith(".set"):
        mapping = parse_jsonish(cfg.get("mapping"), default=None) or {}
        count = 0
        ttl = cfg.get("ttl") or cfg.get("ex")
        if key and cfg.get("value") is not None:
            client.set(key, _redis_value(cfg.get("value")), ex=int(ttl) if ttl not in (None, "") else None)
            count = 1
        for row in rows_in:
            k = str(row.get("key") or mapping.get("key") or key)
            v = row.get("value") if "value" in row else row
            if not k:
                continue
            client.set(k, _redis_value(v))
            count += 1
        return _emit_plugin(task, {"ok": True, "op": t, "count": count, "rows": [{"written": count}]})
    if t.endswith(".delete"):
        keys = [k for k in ([key] if key else [str(r.get("key") or "") for r in rows_in]) if k]
        n = client.delete(*keys) if keys else 0
        return _emit_plugin(task, {"ok": True, "op": t, "deleted": n, "rows": [{"deleted": n}]})
    if t.endswith(".scan"):
        pattern = str(cfg.get("pattern") or cfg.get("target") or "*")
        found = []
        for k in client.scan_iter(match=pattern, count=int(cfg.get("batchSize") or 100)):
            found.append({"key": k})
            if len(found) >= int(cfg.get("limit") or 1000):
                break
        return _emit_plugin(task, {"ok": True, "op": t, "rows": found})
    if "hash" in t:
        data = client.hgetall(key) if key else {}
        return _emit_plugin(task, {"ok": True, "op": t, "rows": [{"field": f, "value": v} for f, v in (data or {}).items()] or [{"key": key}]})
    if "publish" in t:
        channel = key or str(cfg.get("source") or "channel")
        n = client.publish(channel, json.dumps(rows_in[:1] or cfg.get("value") or {}, default=str))
        return _emit_plugin(task, {"ok": True, "op": t, "receivers": n, "rows": [{"receivers": n}]})
    if "streamAdd" in t or t.endswith(".streamAdd"):
        name = key or str(cfg.get("source") or "stream")
        ids = []
        for row in rows_in or [{"payload": cfg.get("value") or ""}]:
            flat = {str(k): str(v) for k, v in row.items()}
            ids.append({"id": client.xadd(name, flat)})
        return _emit_plugin(task, {"ok": True, "op": t, "rows": ids})
    if "streamRead" in t:
        name = key or str(cfg.get("source") or "stream")
        entries = client.xread({name: "0-0"}, count=int(cfg.get("batchSize") or 100), block=1000) or []
        rows = []
        for _s, items in entries:
            for eid, fields in items:
                rows.append({"id": eid, **fields})
        return _emit_plugin(task, {"ok": True, "op": t, "rows": rows})
    raise RuntimeError(f"Unsupported redis node: {t}")


def handle_kafka(task: dict, ctx: dict) -> dict:
    _conn, _cc, blob, cfg = _connector_bundle(task, ctx)
    bootstrap = str(
        cfg.get("bootstrapServers")
        or cfg.get("brokers")
        or cfg.get("host")
        or blob.get("bootstrapServers")
        or "127.0.0.1:9092"
    )
    topic = str(cfg.get("target") or cfg.get("source") or cfg.get("topic") or cfg.get("resourceName") or "")
    t = str(task.get("type") or "")
    try:
        import kafka  # type: ignore  # noqa: F401
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(
            "kafka-python is required for kafka.* nodes — install kafka-python>=2.0.3 or "
            f"kafka-python-ng (2.0.2 does not import on Python 3.12+): {exc}"
        ) from exc
    # Security settings apply to every client (Confluent Cloud / MSK need SASL_SSL)
    kafka_kw: dict[str, Any] = {"bootstrap_servers": bootstrap.split(",")}
    protocol = str(cfg.get("securityProtocol") or blob.get("securityProtocol") or "").strip().upper()
    sasl_user = blob.get("username") or cfg.get("username")
    sasl_pass = blob.get("password") or cfg.get("password")
    if sasl_user and not protocol:
        protocol = "SASL_SSL"
    if protocol and protocol != "PLAINTEXT":
        kafka_kw["security_protocol"] = protocol
    if sasl_user and protocol.startswith("SASL"):
        kafka_kw["sasl_mechanism"] = str(cfg.get("saslMechanism") or "PLAIN").upper()
        kafka_kw["sasl_plain_username"] = str(sasl_user)
        kafka_kw["sasl_plain_password"] = "" if sasl_pass is None else str(sasl_pass)
    if t.endswith(".listTopics") or t.endswith(".list"):
        from kafka.admin import KafkaAdminClient  # type: ignore
        admin = KafkaAdminClient(**kafka_kw)
        names = list(admin.list_topics() or [])
        admin.close()
        return _emit_plugin(task, {"ok": True, "op": t, "rows": [{"topic": n} for n in names]})
    if t.endswith(".createTopic"):
        from kafka.admin import KafkaAdminClient, NewTopic  # type: ignore

        admin = KafkaAdminClient(**kafka_kw)
        name = topic or str(cfg.get("resourceName") or "studio_topic")
        admin.create_topics([NewTopic(name=name, num_partitions=1, replication_factor=1)])
        admin.close()
        return _emit_plugin(task, {"ok": True, "op": t, "rows": [{"topic": name}]})
    if t.endswith(".produce"):
        from kafka import KafkaProducer  # type: ignore

        producer = KafkaProducer(
            **kafka_kw,
            value_serializer=lambda v: json.dumps(v, default=str).encode("utf-8"),
        )
        if not topic:
            raise RuntimeError("kafka.produce requires target/topic")
        sent = 0
        for row in _rows_from_task_inputs(task) or [{"value": cfg.get("query") or cfg.get("value")}]:
            producer.send(topic, row)
            sent += 1
        producer.flush()
        producer.close()
        return _emit_plugin(task, {"ok": True, "op": t, "sent": sent, "rows": [{"sent": sent, "topic": topic}]})
    if t.endswith(".consume") or t.endswith(".seek"):
        from kafka import KafkaConsumer  # type: ignore

        if not topic:
            raise RuntimeError("kafka.consume requires source/topic")
        consumer = KafkaConsumer(
            topic,
            **kafka_kw,
            auto_offset_reset="earliest",
            enable_auto_commit=False,
            consumer_timeout_ms=int(cfg.get("timeoutMs") or 4000),
            value_deserializer=lambda b: json.loads(b.decode("utf-8")) if b else None,
        )
        rows = []
        for msg in consumer:
            val = msg.value if isinstance(msg.value, dict) else {"value": msg.value}
            rows.append({"topic": msg.topic, "partition": msg.partition, "offset": msg.offset, **val})
            if len(rows) >= int(cfg.get("batchSize") or 100):
                break
        consumer.close()
        return _emit_plugin(task, {"ok": True, "op": t, "rows": rows})
    if "deleteRecords" in t:
        from kafka.admin import KafkaAdminClient  # type: ignore
        from kafka.structs import TopicPartition  # type: ignore

        target_topic = topic or str(cfg.get("source") or "")
        if not target_topic:
            raise RuntimeError("kafka.deleteRecords requires target/topic")
        part = int(cfg.get("partition") or 0)
        offset = int(cfg.get("offset") if cfg.get("offset") not in (None, "") else -1)
        tp = TopicPartition(target_topic, part)
        admin = KafkaAdminClient(**kafka_kw)
        try:
            if not hasattr(admin, "delete_records"):
                raise RuntimeError(
                    "installed kafka-python has no KafkaAdminClient.delete_records — "
                    "upgrade kafka-python (>=2.1) to use kafka.deleteRecords"
                )
            try:
                # Older kafka-python forks wrap the offset in RecordsToDelete
                from kafka.admin import RecordsToDelete  # type: ignore

                result = admin.delete_records({tp: RecordsToDelete(offset)})
            except ImportError:
                # kafka-python 2.1+/3.x: plain int offset (-1 = high watermark)
                result = admin.delete_records({tp: offset})
        finally:
            admin.close()
        row = {"topic": target_topic, "partition": part, "before_offset": offset}
        if isinstance(result, dict):
            info = result.get(tp)
            if isinstance(info, dict):
                row.update({k: v for k, v in info.items() if not isinstance(v, (dict, list))})
            elif info is not None:
                row["low_watermark"] = getattr(info, "low_watermark", info)
        return _emit_plugin(task, {"ok": True, "op": t, "rows": [row]})
    if "describe" in t:
        from kafka.admin import KafkaAdminClient  # type: ignore

        admin = KafkaAdminClient(**kafka_kw)
        group = str(cfg.get("resourceName") or cfg.get("groupId") or cfg.get("target") or "")
        rows: list[dict] = []
        try:
            if group and hasattr(admin, "describe_consumer_groups"):
                desc = admin.describe_consumer_groups([group])
                for item in desc or []:
                    if hasattr(item, "_asdict"):
                        # kafka-python GroupInformation namedtuple — json.dumps would drop field names
                        item = item._asdict()
                    rows.append(json.loads(json.dumps(item, default=str)))
            elif group:
                # kafka-python builds without describe_consumer_groups: committed offsets + lag
                committed = admin.list_consumer_group_offsets(group_id=group) or {}
                end_offsets: dict = {}
                if committed:
                    from kafka import KafkaConsumer  # type: ignore

                    probe = KafkaConsumer(**kafka_kw)
                    try:
                        end_offsets = probe.end_offsets(list(committed.keys())) or {}
                    finally:
                        probe.close()
                for tp, meta in committed.items():
                    current = getattr(meta, "offset", meta)
                    end = end_offsets.get(tp)
                    rows.append({
                        "group": group,
                        "topic": tp.topic,
                        "partition": tp.partition,
                        "committed_offset": current,
                        "end_offset": end,
                        "lag": (end - current) if isinstance(end, int) and isinstance(current, int) and current >= 0 else None,
                    })
                if not rows:
                    rows = [{"group": group, "state": "no committed offsets"}]
            else:
                groups = list(getattr(admin, "list_consumer_groups", lambda: [])() or [])
                for g in groups:
                    if isinstance(g, (tuple, list)) and g:
                        rows.append({"group": str(g[0]), "protocol_type": g[1] if len(g) > 1 else None})
                    else:
                        rows.append({"group": str(g)})
        finally:
            admin.close()
        return _emit_plugin(task, {"ok": True, "op": t, "rows": rows or [{"bootstrap": bootstrap, "topic": topic, "group": group}]})
    raise RuntimeError(f"Unsupported kafka node: {t}")


def _gcp_credentials(blob: dict, cfg: dict):
    raw = (
        blob.get("serviceAccountJson")
        or blob.get("credentials")
        or blob.get("json")
        or cfg.get("serviceAccountJson")
        or cfg.get("credentials")
    )
    if isinstance(raw, str) and raw.strip().startswith("{"):
        raw = json.loads(raw)
    if not isinstance(raw, dict):
        return None
    try:
        from google.oauth2 import service_account  # type: ignore
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"google-auth is required for GCP service-account auth: {exc}") from exc
    return service_account.Credentials.from_service_account_info(raw)


def handle_object_store(task: dict, ctx: dict) -> dict:
    """GCS / Azure Blob via boto3-compatible or azure SDK; S3-style HMAC when possible."""
    t = str(task.get("type") or "")
    _conn, _cc, blob, cfg = _connector_bundle(task, ctx)
    if t.startswith("gcs."):
        try:
            from google.cloud import storage  # type: ignore
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"google-cloud-storage is required for gcs.* nodes: {exc}") from exc
        creds = _gcp_credentials(blob, cfg)
        project = cfg.get("project") or cfg.get("projectId") or blob.get("project") or blob.get("projectId")
        client = storage.Client(project=project or None, credentials=creds) if creds else storage.Client(project=project or None)
        bucket_name = str(cfg.get("bucket") or cfg.get("scope") or cfg.get("target") or "")
        key = str(cfg.get("key") or cfg.get("path") or cfg.get("resourceName") or "")
        if t.endswith(".list"):
            bucket = client.bucket(bucket_name)
            prefix = str(cfg.get("pattern") or key or "")
            rows = [{"name": b.name, "size": b.size, "updated": str(b.updated)} for b in client.list_blobs(bucket, prefix=prefix)]
            return _emit_plugin(task, {"ok": True, "op": t, "rows": rows})
        if t.endswith(".read"):
            gblob = client.bucket(bucket_name).blob(key)
            # download_as_bytes arrived in google-cloud-storage 1.32; older builds only have download_as_string
            download = getattr(gblob, "download_as_bytes", None) or gblob.download_as_string
            data = download()
            text = data.decode("utf-8", errors="replace")
            try:
                parsed = json.loads(text)
                rows = parsed if isinstance(parsed, list) else [parsed]
            except Exception:  # noqa: BLE001
                rows = [{"content": text[:8000], "bytes": len(data)}]
            return _emit_plugin(task, {"ok": True, "op": t, "rows": normalize_rows(rows)})
        if t.endswith(".write"):
            body = json.dumps(_rows_from_task_inputs(task), default=str).encode("utf-8")
            client.bucket(bucket_name).blob(key).upload_from_string(body, content_type="application/json")
            return _emit_plugin(task, {"ok": True, "op": t, "rows": [{"bucket": bucket_name, "key": key, "bytes": len(body)}]})
        if t.endswith(".delete"):
            client.bucket(bucket_name).blob(key).delete()
            return _emit_plugin(task, {"ok": True, "op": t, "rows": [{"deleted": key}]})
        if t.endswith(".createBucket"):
            client.create_bucket(bucket_name or str(cfg.get("resourceName")))
            return _emit_plugin(task, {"ok": True, "op": t, "rows": [{"bucket": bucket_name}]})
        blob_obj = client.bucket(bucket_name).blob(key)
        if t.endswith(".copy"):
            dest = str(cfg.get("destination") or cfg.get("resourceName") or key + ".copy")
            dest_bucket, dest_key = (dest.split("/", 1) + [dest])[:2] if "/" in dest else (bucket_name, dest)
            client.bucket(bucket_name).copy_blob(blob_obj, client.bucket(dest_bucket or bucket_name), dest_key)
            return _emit_plugin(task, {"ok": True, "op": t, "rows": [{"src": key, "dest": dest}]})
        if t.endswith(".metadata"):
            blob_obj.reload()
            return _emit_plugin(task, {"ok": True, "op": t, "rows": [{"name": blob_obj.name, "size": blob_obj.size, "contentType": blob_obj.content_type, "updated": str(blob_obj.updated)}]})
        if "signed" in t:
            import datetime as _dt

            sign_kw: dict[str, Any] = {
                "expiration": _dt.timedelta(hours=int(cfg.get("ttl") or 1)),
                "method": str(cfg.get("method") or "GET"),
            }
            try:
                # V4 signing (v2 is legacy); older clients without the version kwarg fall back
                url = blob_obj.generate_signed_url(version="v4", **sign_kw)
            except TypeError:
                url = blob_obj.generate_signed_url(**sign_kw)
            return _emit_plugin(task, {"ok": True, "op": t, "rows": [{"url": url, "bucket": bucket_name, "key": key}]})
        raise RuntimeError(f"Unsupported gcs node: {t}")
    # azure_blob
    try:
        from azure.storage.blob import BlobServiceClient  # type: ignore
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"azure-storage-blob is required for azure_blob.* nodes: {exc}") from exc
    conn_str = blob.get("connectionString") or blob.get("uri") or cfg.get("connectionString") or cfg.get("uri")
    if not conn_str:
        account = cfg.get("account") or blob.get("accountName")
        key = blob.get("accountKey") or blob.get("key")
        if account and key:
            conn_str = f"DefaultEndpointsProtocol=https;AccountName={account};AccountKey={key};EndpointSuffix=core.windows.net"
    if not conn_str:
        raise RuntimeError("Azure Blob connectionString / account+key missing")
    if str(conn_str).lower().startswith("https://"):
        # Account URL (optionally with ?SAS) instead of a connection string
        credential = blob.get("accountKey") or blob.get("sasToken") or blob.get("key") or None
        if credential is None and "?" not in str(conn_str):
            try:
                from azure.identity import DefaultAzureCredential  # type: ignore

                credential = DefaultAzureCredential()
            except Exception:  # noqa: BLE001
                credential = None
        svc = BlobServiceClient(account_url=str(conn_str), credential=credential)
    else:
        svc = BlobServiceClient.from_connection_string(str(conn_str))
    container = str(cfg.get("container") or cfg.get("scope") or cfg.get("bucket") or cfg.get("target") or "")
    blob_name = str(cfg.get("key") or cfg.get("path") or cfg.get("resourceName") or "")
    if t.endswith(".list"):
        cc = svc.get_container_client(container)
        rows = [{"name": b.name, "size": b.size} for b in cc.list_blobs(name_starts_with=str(cfg.get("pattern") or ""))]
        return _emit_plugin(task, {"ok": True, "op": t, "rows": rows})
    if t.endswith(".read"):
        data = svc.get_blob_client(container, blob_name).download_blob().readall()
        text = data.decode("utf-8", errors="replace")
        try:
            parsed = json.loads(text)
            rows = parsed if isinstance(parsed, list) else [parsed]
        except Exception:  # noqa: BLE001
            rows = [{"content": text[:8000], "bytes": len(data)}]
        return _emit_plugin(task, {"ok": True, "op": t, "rows": normalize_rows(rows)})
    if t.endswith(".write"):
        body = json.dumps(_rows_from_task_inputs(task), default=str).encode("utf-8")
        svc.get_blob_client(container, blob_name).upload_blob(body, overwrite=True)
        return _emit_plugin(task, {"ok": True, "op": t, "rows": [{"container": container, "blob": blob_name, "bytes": len(body)}]})
    if t.endswith(".delete"):
        svc.get_blob_client(container, blob_name).delete_blob()
        return _emit_plugin(task, {"ok": True, "op": t, "rows": [{"deleted": blob_name}]})
    if "createContainer" in t:
        svc.create_container(container or str(cfg.get("resourceName")))
        return _emit_plugin(task, {"ok": True, "op": t, "rows": [{"container": container}]})
    if t.endswith(".copy"):
        dest = str(cfg.get("destination") or cfg.get("resourceName") or blob_name + ".copy")
        src = svc.get_blob_client(container, blob_name)
        svc.get_blob_client(container, dest).start_copy_from_url(src.url)
        return _emit_plugin(task, {"ok": True, "op": t, "rows": [{"src": blob_name, "dest": dest}]})
    if t.endswith(".sas"):
        from datetime import datetime, timedelta, timezone
        from azure.storage.blob import generate_blob_sas, BlobSasPermissions  # type: ignore

        account = cfg.get("account") or blob.get("accountName")
        account_key = blob.get("accountKey") or blob.get("key")
        if not account or not account_key:
            bc = svc.get_blob_client(container, blob_name)
            return _emit_plugin(task, {"ok": True, "op": t, "rows": [{"url": bc.url, "note": "accountKey required for SAS"}]})
        sas = generate_blob_sas(
            account_name=str(account),
            container_name=container,
            blob_name=blob_name,
            account_key=str(account_key),
            permission=BlobSasPermissions(read=True),
            expiry=datetime.now(timezone.utc) + timedelta(hours=int(cfg.get("ttl") or 1)),
        )
        url = f"https://{account}.blob.core.windows.net/{container}/{blob_name}?{sas}"
        return _emit_plugin(task, {"ok": True, "op": t, "rows": [{"url": url}]})
    if t.endswith(".properties"):
        bc = svc.get_blob_client(container, blob_name)
        props = bc.get_blob_properties()
        return _emit_plugin(task, {"ok": True, "op": t, "rows": [{"name": blob_name, "size": props.size, "url": bc.url}]})
    raise RuntimeError(f"Unsupported azure_blob node: {t}")


_ES_SEARCH_TOP_KEYS = {
    "query", "size", "from", "sort", "aggs", "aggregations", "_source", "track_total_hits",
    "highlight", "search_after", "fields", "post_filter", "knn", "min_score", "timeout",
    "collapse", "script_fields", "docvalue_fields", "stored_fields", "pit", "runtime_mappings",
    "suggest", "explain", "version", "seq_no_primary_term", "indices_boost", "rescore",
    "terminate_after",
}


def _module_http_json(*args: Any, **kwargs: Any) -> Any:
    return http_json(*args, **kwargs)


def _es_auth_headers(blob: dict, cfg: dict) -> dict:
    """Elasticsearch / OpenSearch auth: Basic (elastic user), ApiKey (ES 7.x+/8.x) or Bearer."""
    headers = _http_auth_headers(blob, cfg)
    api_key = blob.get("apiKey") or cfg.get("apiKey")
    if api_key and not (blob.get("token") or blob.get("accessToken") or cfg.get("token")):
        key = str(api_key)
        if ":" in key:
            key = base64.b64encode(key.encode("utf-8")).decode("ascii")
        headers["Authorization"] = key if key.lower().startswith("apikey ") else f"ApiKey {key}"
    return headers


def _es_total(data: Any) -> Any:
    """hits.total is an int on ES 6 and {value, relation} on ES 7+/8 and OpenSearch."""
    total = ((data.get("hits") or {}).get("total")) if isinstance(data, dict) else None
    return total.get("value") if isinstance(total, dict) else total


def handle_elasticsearch_write(task: dict, ctx: dict) -> dict:
    t = str(task.get("type") or "")
    connector, _cc, blob, cfg = _connector_bundle(task, ctx)
    host = str(cfg.get("url") or cfg.get("host") or "http://127.0.0.1:9200").rstrip("/")
    if not host.startswith("http"):
        host = "http://" + host
    headers = _es_auth_headers(blob, cfg)
    tls = _tls_context(cfg, host)

    def http_json(url: str, method: str = "GET", hdrs: dict | None = None, body: Any = None) -> Any:
        # ES 8 / OpenSearch default to HTTPS with a self-signed cert
        if tls is None:
            return _module_http_json(url, method, hdrs, body)
        return _module_http_json(url, method, hdrs, body, ssl_context=tls)

    index = str(cfg.get("target") or cfg.get("index") or cfg.get("resourceName") or "_all")
    if t.endswith(".search"):
        body = parse_jsonish(cfg.get("query") or cfg.get("filter") or cfg.get("statement"), default=None)
        if not isinstance(body, dict) or not body:
            body = {"query": {"match_all": {}}}
        elif not (set(body) & _ES_SEARCH_TOP_KEYS):
            # a bare query clause ({"match": …}, {"bool": …}, {"term": …})
            body = {"query": body}
        size = int(cfg.get("limit") or cfg.get("batchSize") or 100)
        body.setdefault("size", size)
        data = http_json(f"{host}/{index}/_search", "POST", headers, body)
        hits = ((data.get("hits") or {}).get("hits") or []) if isinstance(data, dict) else []
        rows = []
        for hit in hits:
            src = hit.get("_source") if isinstance(hit, dict) else None
            rec = dict(src) if isinstance(src, dict) else {"_source": src}
            rec["_id"] = hit.get("_id") if isinstance(hit, dict) else None
            rec["_index"] = hit.get("_index") if isinstance(hit, dict) else index
            rec["_score"] = hit.get("_score") if isinstance(hit, dict) else None
            rows.append(rec)
        raw_total = ((data.get("hits") or {}).get("total")) if isinstance(data, dict) else None
        return _emit_plugin(task, {"ok": True, "op": t, "rows": rows, "total": raw_total, "totalHits": _es_total(data)})
    if t.endswith(".listIndices") or ".list" in t:
        data = http_json(host + "/_cat/indices?format=json", "GET", headers)
        rows = data if isinstance(data, list) else [data]
        return _emit_plugin(task, {"ok": True, "op": t, "rows": rows})
    if t.endswith(".index"):
        rows_in = _rows_from_task_inputs(task)
        doc = rows_in[0] if rows_in else parse_jsonish(cfg.get("statement"), default={}) or {}
        data = http_json(f"{host}/{index}/_doc", "POST", headers, doc)
        return _emit_plugin(task, {"ok": True, "op": t, "rows": [data if isinstance(data, dict) else {"result": data}]})
    if t.endswith(".bulk"):
        rows_in = _rows_from_task_inputs(task)
        lines = []
        for row in rows_in:
            lines.append(json.dumps({"index": {"_index": index}}))
            lines.append(json.dumps(row, default=str))
        body = ("\\n".join(lines) + "\\n").encode("utf-8")
        req = urllib.request.Request(
            host + "/_bulk",
            data=body,
            headers={**headers, "Content-Type": "application/x-ndjson"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=120, context=tls) as resp:  # noqa: S310
            data = json.loads(resp.read().decode("utf-8"))
        return _emit_plugin(task, {"ok": True, "op": t, "rows": [{"items": len(rows_in), "errors": data.get("errors")}]})
    if t.endswith(".delete"):
        filt = parse_jsonish(cfg.get("filter") or cfg.get("statement"), default={}) or {"match_all": {}}
        data = http_json(f"{host}/{index}/_delete_by_query", "POST", headers, {"query": filt})
        return _emit_plugin(task, {"ok": True, "op": t, "rows": [data if isinstance(data, dict) else {"result": data}]})
    if "createIndex" in t:
        body = parse_jsonish(cfg.get("definition"), default={}) or {}
        data = http_json(f"{host}/{index}", "PUT", headers, body)
        return _emit_plugin(task, {"ok": True, "op": t, "rows": [data if isinstance(data, dict) else {"result": data}]})
    if "putMapping" in t:
        body = parse_jsonish(cfg.get("definition"), default={}) or {}
        data = http_json(f"{host}/{index}/_mapping", "PUT", headers, body)
        return _emit_plugin(task, {"ok": True, "op": t, "rows": [data if isinstance(data, dict) else {"result": data}]})
    if "reindex" in t:
        dest = str(cfg.get("resourceName") or cfg.get("destination") or index + "_reindex")
        data = http_json(host + "/_reindex", "POST", headers, {"source": {"index": index}, "dest": {"index": dest}})
        return _emit_plugin(task, {"ok": True, "op": t, "rows": [data if isinstance(data, dict) else {"result": data}]})
    return handle_sqlish_read(task, ctx)


def handle_neo4j(task: dict, ctx: dict) -> dict:
    try:
        from neo4j import GraphDatabase  # type: ignore
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"neo4j package is required for neo4j.* nodes: {exc}") from exc
    _conn, _cc, blob, cfg = _connector_bundle(task, ctx)
    uri = str(blob.get("uri") or cfg.get("uri") or cfg.get("url") or "bolt://127.0.0.1:7687")
    user = blob.get("username") or cfg.get("username") or "neo4j"
    password = blob.get("password") or cfg.get("password") or ""
    driver = GraphDatabase.driver(uri, auth=(user, password))
    database = str(cfg.get("database") or blob.get("database") or "").strip()
    cypher = str(cfg.get("query") or cfg.get("sql") or cfg.get("cypher") or cfg.get("statement") or cfg.get("definition") or "")
    t = str(task.get("type") or "")
    if t.endswith(".listLabels"):
        cypher = cypher or "CALL db.labels() YIELD label RETURN label"
    if t.endswith(".createConstraint") or t.endswith(".createIndex"):
        cypher = cypher or str(cfg.get("definition") or "")
    if t.endswith(".loadCsv") and not cypher:
        path = str(cfg.get("path") or cfg.get("source") or cfg.get("url") or "")
        if not path:
            raise RuntimeError("neo4j.loadCsv requires path/url to a CSV")
        cypher = f"LOAD CSV WITH HEADERS FROM '{path}' AS row RETURN row LIMIT 100"
    if t.endswith(".delete") and not cypher:
        label = str(cfg.get("target") or cfg.get("resourceName") or "")
        filt = parse_jsonish(cfg.get("filter"), default={}) or {}
        where = ""
        if isinstance(filt, dict) and filt:
            parts = [f"n.{k} = {json.dumps(v)}" for k, v in filt.items()]
            where = " WHERE " + " AND ".join(parts)
        cypher = f"MATCH (n{':' + label if label else ''}){where} DETACH DELETE n RETURN count(*) AS deleted"
    if not cypher:
        raise RuntimeError(f"{t} requires a Cypher statement")
    rows = []
    try:
        session_cm = driver.session(database=database) if database else driver.session()
    except TypeError:
        # neo4j driver 1.7 (Neo4j 3.x) has no multi-database sessions
        session_cm = driver.session()
    try:
        with session_cm as session:
            result = session.run(cypher)
            for rec in result:
                rows.append(dict(rec))
    finally:
        driver.close()
    return _emit_plugin(task, {"ok": True, "op": t, "rows": rows or [{"ok": True}]})


def _flink_upload_jar(base: str, headers: dict, path: str) -> str:
    """POST /jars/upload (multipart) and return the Flink JAR id."""
    import os
    import uuid

    boundary = "----studio" + uuid.uuid4().hex
    name = os.path.basename(path)
    with open(path, "rb") as f:
        payload = f.read()
    body = (
        f"--{boundary}\\r\\n"
        f'Content-Disposition: form-data; name="jarfile"; filename="{name}"\\r\\n'
        "Content-Type: application/x-java-archive\\r\\n\\r\\n"
    ).encode("utf-8") + payload + f"\\r\\n--{boundary}--\\r\\n".encode("utf-8")
    hdrs = {k: v for k, v in headers.items() if k.lower() != "content-type"}
    hdrs["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    req = urllib.request.Request(f"{base}/jars/upload", data=body, method="POST", headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:  # noqa: S310
            data = json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:800]
        raise RuntimeError(f"Flink JAR upload failed HTTP {exc.code}: {detail}") from exc
    filename = str(data.get("filename") or "")
    if not filename:
        raise RuntimeError(f"Flink JAR upload returned no filename: {data}")
    return filename.replace("\\\\", "/").rsplit("/", 1)[-1]


_DBT_VERSION_CACHE: dict[str, dict] = {}
_DBT_STATUSES = {
    "success", "error", "skipped", "pass", "fail", "warn", "runtime error",
    "partial success", "no-op", "reused",
}


def _dbt_core_version(exe: str) -> dict:
    """Parse \`dbt --version\` for dbt 0.x, 1.x and the Fusion engine (2.x / dbtf)."""
    import re
    import subprocess

    if exe in _DBT_VERSION_CACHE:
        return _DBT_VERSION_CACHE[exe]
    info: dict[str, Any] = {"version": None, "tuple": (0, 0, 0), "engine": "core"}
    try:
        proc = subprocess.run(  # noqa: S603
            [exe, "--version"], capture_output=True, text=True, timeout=60
        )
        text = f"{proc.stdout}\\n{proc.stderr}"
        m = re.search(r"installed(?: version)?:\\s*v?(\\d+)\\.(\\d+)\\.(\\d+)", text) or re.search(
            r"(\\d+)\\.(\\d+)\\.(\\d+)", text
        )
        if m:
            info["tuple"] = tuple(int(x) for x in m.groups())
            info["version"] = ".".join(m.groups())
        if "fusion" in text.lower() or info["tuple"][0] >= 2:
            info["engine"] = "fusion"
    except Exception:  # noqa: BLE001 — unknown version = assume current flags
        pass
    _DBT_VERSION_CACHE[exe] = info
    return info


def _dbt_core_command(exe: str, cause: str, cfg: dict, version: dict) -> list[str]:
    """Build a dbt CLI command using the flag names the installed version understands."""
    import shlex

    v = tuple(version.get("tuple") or (0, 0, 0))
    known = v != (0, 0, 0)
    if cause == "build" and known and v < (0, 21, 0):
        raise RuntimeError(f"dbt build needs dbt >= 0.21 (installed {version.get('version')}) — use dbt.run + dbt.test")
    cmd = [exe, "docs", "generate"] if cause == "docs" else [exe, cause]

    raw_extra = parse_jsonish(cfg.get("parameters"), default=None)
    if isinstance(raw_extra, list):
        extra = [str(x) for x in raw_extra]
    elif isinstance(raw_extra, dict):
        extra = []
        for k, val in raw_extra.items():
            flag = str(k) if str(k).startswith("-") else f"--{k}"
            if val is True:
                extra.append(flag)
            elif val not in (None, False, ""):
                extra.extend([flag, json.dumps(val) if isinstance(val, (dict, list)) else str(val)])
    elif isinstance(raw_extra, str) and raw_extra.strip():
        extra = shlex.split(raw_extra)
    else:
        extra = []
    present = {x.split("=", 1)[0] for x in extra if x.startswith("-")}

    def add(flags: tuple[str, ...], value: Any = None, *, switch: bool = False) -> None:
        if present.intersection(flags):
            return
        if switch:
            cmd.append(flags[0])
        elif value not in (None, ""):
            cmd.extend([flags[0], json.dumps(value) if isinstance(value, (dict, list)) else str(value)])

    select = cfg.get("select") or cfg.get("models") or (cfg.get("suite") if cause == "test" else None)
    if select and cause != "docs":
        # dbt < 0.21 used --models for run/test/compile; seed/snapshot always took --select
        use_models = known and v < (0, 21, 0) and cause in ("run", "test", "compile")
        add(("--models", "-m", "--select", "-s") if use_models else ("--select", "-s", "--models", "-m"), select)
    add(("--exclude",), cfg.get("exclude"))
    add(("--target", "-t"), cfg.get("profileTarget"))
    add(("--profiles-dir",), cfg.get("profilesDir"))
    add(("--vars",), parse_jsonish(cfg.get("vars"), default=cfg.get("vars")))
    if cfg.get("threads") not in (None, ""):
        add(("--threads",), int(cfg.get("threads")))
    if cfg.get("fullRefresh") and cause in ("run", "build", "seed"):
        add(("--full-refresh",), switch=True)
    if cfg.get("targetPath") and (not known or v >= (1, 5, 0)):
        add(("--target-path",), cfg.get("targetPath"))
    return cmd + extra


def _dbt_result_status(r: dict) -> str:
    """run_results.json status across schema v1–v6 (dbt 0.x put adapter text in status)."""
    s = r.get("status")
    if isinstance(s, str) and s.strip().lower() in _DBT_STATUSES:
        return s.strip().lower()
    if r.get("error") or (isinstance(s, str) and s.strip().upper() == "ERROR"):
        return "error"
    if r.get("fail"):
        return "fail"
    if r.get("warn"):
        return "warn"
    if r.get("skip"):
        return "skipped"
    return "success"


def _dbt_results_rows(doc: dict) -> tuple[list[dict], dict]:
    meta = doc.get("metadata") or {}
    rows: list[dict] = []
    for r in doc.get("results") or []:
        if not isinstance(r, dict):
            continue
        node = r.get("node") if isinstance(r.get("node"), dict) else {}
        rows.append({
            "unique_id": r.get("unique_id") or node.get("unique_id"),
            "status": _dbt_result_status(r),
            "execution_time": r.get("execution_time"),
            "message": r.get("message") or (r.get("error") if isinstance(r.get("error"), str) else None),
            "failures": r.get("failures"),
            "relation_name": r.get("relation_name") or node.get("relation_name"),
            "invocation_id": meta.get("invocation_id"),
        })
    failed = sum(1 for row in rows if row["status"] in ("error", "fail", "runtime error"))
    summary = {
        "invocation_id": meta.get("invocation_id"),
        "generated_at": meta.get("generated_at"),
        "dbt_schema_version": meta.get("dbt_schema_version"),
        "dbt_version": meta.get("dbt_version"),
        "elapsed_time": doc.get("elapsed_time"),
        "total": len(rows),
        "failed": failed,
        "status": "error" if failed else "success",
    }
    return rows, summary


def _dbt_cloud_api_base(cfg: dict) -> str:
    """dbt Cloud admin API v2 on any region / cell host (cloud.getdbt.com, emea.dbt.com, <prefix>.us1.dbt.com)."""
    raw = str(
        cfg.get("baseUrl") or cfg.get("apiUrl") or cfg.get("host") or cfg.get("url") or "https://cloud.getdbt.com"
    ).strip().rstrip("/")
    if "://" not in raw:
        raw = "https://" + raw
    for suffix in ("/api/v2", "/api/v3", "/api"):
        if raw.endswith(suffix):
            raw = raw[: -len(suffix)]
            break
    return raw + "/api/v2"


def _dbt_cloud_run_row(data: Any) -> dict:
    run = data.get("data") if isinstance(data, dict) and isinstance(data.get("data"), dict) else data
    if not isinstance(run, dict):
        return {"result": data}
    codes = {1: "queued", 2: "starting", 3: "running", 10: "success", 20: "error", 30: "cancelled"}
    code = run.get("status")
    status = run.get("status_humanized") or codes.get(code) or code
    return {
        "run_id": run.get("id"),
        "runId": run.get("id"),
        "job_id": run.get("job_definition_id") or run.get("job_id"),
        "status": str(status).lower() if status is not None else None,
        "status_code": code,
        "is_complete": run.get("is_complete"),
        "is_success": run.get("is_success"),
        "is_error": run.get("is_error"),
        "href": run.get("href"),
        "duration": run.get("duration_humanized") or run.get("duration"),
        "git_sha": run.get("git_sha"),
    }


def handle_http_product(task: dict, ctx: dict) -> dict:
    """Airbyte / NiFi / Dagster / Flink / dbt Cloud / Temporal / GX-over-HTTP."""
    t = str(task.get("type") or "")
    _conn, _cc, blob, cfg = _connector_bundle(task, ctx)
    headers = _http_auth_headers(blob, cfg)
    if t.startswith("airbyte."):
        base = _connector_base_url(cfg, "http://127.0.0.1:8000/api/v1")
        client_id = blob.get("clientId") or cfg.get("clientId")
        client_secret = blob.get("clientSecret") or cfg.get("clientSecret")
        if client_id and client_secret:
            # Airbyte Cloud / Airbyte 1.x (abctl): short-lived token from client credentials
            tok = http_json(base + "/applications/token", "POST",
                            {"Accept": "application/json", "Content-Type": "application/json"},
                            {"client_id": str(client_id), "client_secret": str(client_secret),
                             "grant-type": "client_credentials"})
            if isinstance(tok, dict) and tok.get("access_token"):
                headers["Authorization"] = f"Bearer {tok['access_token']}"
        elif client_secret and "Authorization" not in headers:
            headers["Authorization"] = f"Bearer {client_secret}"  # legacy API key
        flavor = str(cfg.get("apiFlavor") or "").lower()
        lowered = base.lower()
        public_api = flavor == "public" or (flavor != "config" and (
            "api.airbyte.com" in lowered
            or lowered.endswith("/api/public/v1")
            or (lowered.endswith("/v1") and not lowered.endswith("/api/v1"))
        ))
        upstream = _rows_from_task_inputs(task)
        first_up = upstream[0] if upstream and isinstance(upstream[0], dict) else {}
        up_job = first_up.get("jobId") or (
            first_up["job"].get("id") if isinstance(first_up.get("job"), dict) else None
        )
        workspace = cfg.get("scope") or cfg.get("workspaceId")
        if public_api:
            conn_id = str(cfg.get("connectionId") or cfg.get("jobId") or first_up.get("connectionId") or "")
            run_id = str(cfg.get("runId") or up_job or "")
            ws_q = ("?" + urllib.parse.urlencode({"workspaceIds": workspace})) if workspace else ""
            if t.endswith(".listConnections"):
                data = http_json(base + "/connections" + ws_q, "GET", headers)
            elif t.endswith(".listSources"):
                data = http_json(base + "/sources" + ws_q, "GET", headers)
            elif t.endswith(".listDestinations"):
                data = http_json(base + "/destinations" + ws_q, "GET", headers)
            elif t.endswith(".triggerSync") or t.endswith(".reset"):
                data = http_json(base + "/jobs", "POST", headers,
                                 {"connectionId": conn_id, "jobType": "reset" if t.endswith(".reset") else "sync"})
            elif t.endswith(".syncStatus") or t.endswith(".cancelSync"):
                if not run_id:
                    raise RuntimeError(f"{t} requires the job ID (node Run ID or upstream triggerSync $json.jobId)")
                data = http_json(f"{base}/jobs/{urllib.parse.quote(run_id, safe='')}",
                                 "DELETE" if t.endswith(".cancelSync") else "GET", headers)
            else:
                raise RuntimeError(f"Unsupported airbyte node: {t}")
            items = data.get("data") if isinstance(data, dict) and isinstance(data.get("data"), list) else None
            rows = items if items is not None else ([data] if isinstance(data, dict) else [{"result": data}])
            return _emit_plugin(task, {"ok": True, "op": t, "api": "public", "rows": rows or [{"count": 0}], "body": data})
        job_id = str(cfg.get("jobId") or cfg.get("connectionId") or cfg.get("runId") or "")
        if up_job and not cfg.get("runId") and (t.endswith(".syncStatus") or t.endswith(".cancelSync")):
            job_id = str(up_job)
        if t.endswith(".listConnections"):
            data = http_json(base + "/connections/list", "POST", headers, {"workspaceId": cfg.get("scope") or cfg.get("workspaceId")})
        elif t.endswith(".listSources"):
            data = http_json(base + "/sources/list", "POST", headers, {"workspaceId": cfg.get("scope") or cfg.get("workspaceId")})
        elif t.endswith(".listDestinations"):
            data = http_json(base + "/destinations/list", "POST", headers, {"workspaceId": cfg.get("scope") or cfg.get("workspaceId")})
        elif t.endswith(".triggerSync"):
            data = http_json(base + "/connections/sync", "POST", headers, {"connectionId": job_id})
        elif t.endswith(".syncStatus"):
            data = http_json(base + "/jobs/get", "POST", headers, {"id": cfg.get("runId") or job_id})
        elif t.endswith(".cancelSync"):
            data = http_json(base + "/jobs/cancel", "POST", headers, {"id": cfg.get("runId") or job_id})
        elif t.endswith(".reset"):
            try:
                data = http_json(base + "/connections/reset", "POST", headers, {"connectionId": job_id})
            except RuntimeError as exc:
                if "HTTP 404" not in str(exc):
                    raise
                # Airbyte 0.63+/1.x renamed reset to clear
                data = http_json(base + "/connections/clear", "POST", headers, {"connectionId": job_id})
        else:
            raise RuntimeError(f"Unsupported airbyte node: {t}")
        rows = data if isinstance(data, list) else [data] if isinstance(data, dict) else [{"result": data}]
        return _emit_plugin(task, {"ok": True, "op": t, "rows": rows, "body": data})
    if t.startswith("nifi."):
        base = _connector_base_url(cfg, "http://127.0.0.1:8080/nifi-api")
        if not base.rstrip("/").endswith("/nifi-api"):
            base = base.rstrip("/") + "/nifi-api"
        tls = _tls_context(cfg, base)
        pg = str(cfg.get("jobId") or cfg.get("resourceName") or cfg.get("processGroupId") or "root")
        token = blob.get("token") or cfg.get("token")
        user = blob.get("username") or cfg.get("username")
        password = blob.get("password") or cfg.get("password")
        if not token and user and base.lower().startswith("https://"):
            # NiFi does not accept Basic auth — exchange credentials for a JWT
            form = urllib.parse.urlencode({"username": user, "password": password or ""}).encode("utf-8")
            req = urllib.request.Request(
                f"{base}/access/token",
                data=form,
                method="POST",
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            try:
                with urllib.request.urlopen(req, timeout=30, context=tls) as resp:  # noqa: S310
                    token = resp.read().decode("utf-8").strip()
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", errors="replace")[:500]
                raise RuntimeError(f"NiFi login failed HTTP {exc.code}: {detail}") from exc
        if token:
            headers["Authorization"] = f"Bearer {token}"

        def _nifi(path: str, method: str = "GET", body: Any = None) -> Any:
            return http_json(f"{base}{path}", method, headers, body, ssl_context=tls)

        def _nifi_schedule(state: str) -> Any:
            return _nifi(
                f"/flow/process-groups/{pg}",
                "PUT",
                {"id": pg, "state": state, "disconnectedNodeAcknowledged": True},
            )

        def _nifi_major() -> int:
            """1 or 2 from the connector nifiVersion; 0 = unknown (feature fallbacks decide)."""
            raw = str(cfg.get("nifiVersion") or "").strip()
            if raw[:1] in ("1", "2"):
                return int(raw[:1])
            return 0

        def _nifi_update_parameters(values: dict) -> Any:
            """NiFi 2.x (and 1.10+) parameter contexts — replaces the removed variable registry."""
            group = _nifi(f"/process-groups/{pg}") or {}
            comp = group.get("component") or {}
            group_id = group.get("id") or comp.get("id") or pg
            entries = [
                {"parameter": {"name": str(k), "value": None if v is None else str(v), "sensitive": False}}
                for k, v in values.items()
            ]
            ctx_id = (comp.get("parameterContext") or {}).get("id")
            if not ctx_id:
                created = _nifi("/parameter-contexts", "POST", {
                    "revision": {"version": 0},
                    "component": {"name": f"{comp.get('name') or group_id} parameters", "parameters": entries},
                }) or {}
                ctx_id = created.get("id") or (created.get("component") or {}).get("id")
                _nifi(f"/process-groups/{group_id}", "PUT", {
                    "revision": group.get("revision") or {"version": 0},
                    "component": {"id": group_id, "parameterContext": {"id": ctx_id}},
                })
                return {"parameterContextId": ctx_id, "created": True, "processGroupId": group_id,
                        "parameters": sorted(str(k) for k in values)}
            current = _nifi(f"/parameter-contexts/{ctx_id}") or {}
            req = _nifi(f"/parameter-contexts/{ctx_id}/update-requests", "POST", {
                "revision": current.get("revision") or {"version": 0},
                "id": ctx_id,
                "component": {"id": ctx_id, "parameters": entries},
            }) or {}
            status = req.get("request") or {}
            req_id = status.get("requestId")
            deadline = time.time() + float(cfg.get("timeoutSec") or 60)
            while req_id and not status.get("complete") and time.time() < deadline:
                time.sleep(0.5)
                status = (_nifi(f"/parameter-contexts/{ctx_id}/update-requests/{req_id}") or {}).get("request") or status
            if req_id:
                try:
                    _nifi(f"/parameter-contexts/{ctx_id}/update-requests/{req_id}", "DELETE")
                except Exception:  # noqa: BLE001
                    pass
            if status.get("failureReason"):
                raise RuntimeError(f"NiFi parameter update failed: {status.get('failureReason')}")
            return {"parameterContextId": ctx_id, "created": False, "processGroupId": group_id,
                    "complete": bool(status.get("complete", True)),
                    "parameters": sorted(str(k) for k in values)}

        if "listProcessGroups" in t:
            data = _nifi(f"/process-groups/{pg}/process-groups")
            groups = data.get("processGroups") if isinstance(data, dict) else None
            if isinstance(groups, list):
                rows = [
                    {
                        "id": g.get("id"),
                        "name": (g.get("component") or {}).get("name"),
                        "running": g.get("runningCount"),
                        "stopped": g.get("stoppedCount"),
                        "invalid": g.get("invalidCount"),
                    }
                    for g in groups
                    if isinstance(g, dict)
                ]
                return _emit_plugin(task, {"ok": True, "op": t, "rows": rows or [{"processGroupId": pg, "children": 0}], "body": data})
        elif "startProcessGroup" in t:
            data = _nifi_schedule("RUNNING")
        elif "stopProcessGroup" in t:
            data = _nifi_schedule("STOPPED")
        elif "queueStatus" in t:
            data = _nifi(f"/flow/process-groups/{pg}/status")
            snap = ((data or {}).get("processGroupStatus") or {}).get("aggregateSnapshot") if isinstance(data, dict) else None
            if isinstance(snap, dict):
                row = {
                    "processGroupId": pg,
                    "name": snap.get("name"),
                    "queued": snap.get("queued"),
                    "queuedCount": snap.get("queuedCount"),
                    "queuedSize": snap.get("queuedSize"),
                    "activeThreadCount": snap.get("activeThreadCount"),
                }
                return _emit_plugin(task, {"ok": True, "op": t, "rows": [row], "body": data})
        elif "provenance" in t:
            query = parse_jsonish(cfg.get("query"), default=None) or {}
            if not isinstance(query, dict):
                query = {}
            if not query.get("provenance"):
                query = {"provenance": {"request": {"maxResults": int(cfg.get("limit") or 100), **query}}}
            data = _nifi("/provenance", "POST", query)
            prov = data.get("provenance") if isinstance(data, dict) else None
            if isinstance(prov, dict) and prov.get("id"):
                # Provenance queries are asynchronous in NiFi 1.x and 2.x — poll, then release
                prov_id = urllib.parse.quote(str(prov["id"]), safe="")
                deadline = time.time() + float(cfg.get("timeoutSec") or 30)
                while not prov.get("finished") and time.time() < deadline:
                    time.sleep(0.5)
                    polled = _nifi(f"/provenance/{prov_id}")
                    if isinstance(polled, dict) and isinstance(polled.get("provenance"), dict):
                        prov = polled["provenance"]
                try:
                    _nifi(f"/provenance/{prov_id}", "DELETE")
                except Exception:  # noqa: BLE001
                    pass
                events = ((prov.get("results") or {}).get("provenanceEvents")) or []
                rows = [
                    {k: e.get(k) for k in (
                        "eventId", "eventTime", "eventType", "componentId", "componentName",
                        "componentType", "flowFileUuid", "fileSize", "groupId",
                    )}
                    for e in events if isinstance(e, dict)
                ]
                return _emit_plugin(task, {
                    "ok": True, "op": t, "finished": bool(prov.get("finished")),
                    "rows": rows or [{"events": 0, "finished": bool(prov.get("finished"))}],
                    "body": {"provenance": prov},
                })
        elif "updateVariable" in t:
            variables = parse_jsonish(cfg.get("parameters") or cfg.get("variables"), default={}) or {}
            nifi_major = _nifi_major()
            if isinstance(variables, dict) and "variableRegistry" in variables:
                data = _nifi(f"/process-groups/{pg}/variable-registry", "PUT", variables)
            elif not isinstance(variables, dict) or not variables:
                raise RuntimeError("nifi.updateVariable requires parameters as a {name: value} map")
            elif nifi_major >= 2:
                data = _nifi_update_parameters(variables)
            else:
                try:
                    # NiFi 1.x requires the current revision on every registry update
                    current = _nifi(f"/process-groups/{pg}/variable-registry")
                except RuntimeError as exc:
                    if nifi_major == 0 and any(c in str(exc) for c in ("HTTP 404", "HTTP 405")):
                        # NiFi 2.x removed the variable registry — use parameter contexts
                        current = None
                    else:
                        raise
                if current is None:
                    data = _nifi_update_parameters(variables)
                else:
                    revision = current.get("processGroupRevision") if isinstance(current, dict) else None
                    data = _nifi(f"/process-groups/{pg}/variable-registry", "PUT", {
                        "processGroupRevision": revision or {"version": 0},
                        "variableRegistry": {
                            "processGroupId": pg,
                            "variables": [{"variable": {"name": str(k), "value": None if v is None else str(v)}} for k, v in variables.items()],
                        },
                    })
        elif "createProcessor" in t:
            definition = parse_jsonish(cfg.get("definition"), default={}) or {}
            if isinstance(definition, dict) and "component" not in definition:
                definition = {"component": definition}
            if isinstance(definition, dict):
                definition.setdefault("revision", {"version": 0})
            data = _nifi(f"/process-groups/{pg}/processors", "POST", definition)
        else:
            raise RuntimeError(f"Unsupported nifi node: {t}")
        rows = data if isinstance(data, list) else [data] if isinstance(data, dict) else [{"result": data}]
        return _emit_plugin(task, {"ok": True, "op": t, "rows": rows, "body": data})
    if t.startswith("dagster."):
        base = _connector_base_url(cfg, "http://127.0.0.1:3000/graphql")
        if not base.rstrip("/").endswith("/graphql"):
            base = base.rstrip("/") + "/graphql"
        dg_token = blob.get("token") or cfg.get("token")
        if dg_token and (".dagster.cloud" in base or str(cfg.get("mode") or "").lower() == "cloud"):
            # Dagster+ (Cloud) authenticates with its own header, not Bearer
            headers.pop("Authorization", None)
            headers["Dagster-Cloud-Api-Token"] = str(dg_token)
        selector = parse_jsonish(cfg.get("parameters"), default=None) or {}
        if not isinstance(selector, dict):
            selector = {}
        upstream = _rows_from_task_inputs(task)
        first_up = upstream[0] if upstream and isinstance(upstream[0], dict) else {}
        job_name = str(cfg.get("jobId") or selector.get("jobName") or cfg.get("jobName") or "")
        repo = str(selector.get("repositoryName") or cfg.get("repository") or cfg.get("repositoryName") or "")
        loc = str(
            selector.get("repositoryLocationName") or cfg.get("location") or cfg.get("repositoryLocation") or ""
        )
        run_id = str(cfg.get("runId") or first_up.get("runId") or first_up.get("run_id") or "")

        def _gql(query: str, variables: dict | None = None, legacy: tuple | None = None) -> Any:
            data = http_json(base, "POST", headers, {"query": query, "variables": variables or {}})
            errors = data.get("errors") if isinstance(data, dict) else None
            if errors and legacy and any("Cannot query field" in str(e) for e in errors):
                # Dagster < 0.13 (pipelines): retry with the legacy schema
                return _gql(legacy[0], legacy[1] if len(legacy) > 1 else variables)
            if errors:
                raise RuntimeError(f"Dagster GraphQL: {errors}")
            return data.get("data") if isinstance(data, dict) and "data" in data else data

        def _dg_check(payload: Any, key: str, ok: tuple[str, ...]) -> None:
            node = payload.get(key) if isinstance(payload, dict) else None
            typename = node.get("__typename") if isinstance(node, dict) else None
            if typename and typename not in ok:
                raise RuntimeError(f"Dagster {key} returned {typename}: {node.get('message') or node}")

        def _dg_workspace_repos() -> list[tuple[str, str, list[str]]]:
            ws = _gql(
                "query { workspaceOrError { __typename ... on Workspace { locationEntries { name "
                "locationOrLoadError { __typename ... on RepositoryLocation { repositories { name jobs { name } } } } } } } }"
            )
            out = []
            entries = (((ws or {}).get("workspaceOrError") or {}).get("locationEntries")) or []
            for entry in entries:
                loaded = (entry or {}).get("locationOrLoadError") or {}
                for r in loaded.get("repositories") or []:
                    out.append((entry.get("name"), r.get("name"), [j.get("name") for j in r.get("jobs") or []]))
            return out

        if t.endswith(".listJobs"):
            data = _gql(
                "query { workspaceOrError { __typename ... on Workspace { locationEntries { name "
                "locationOrLoadError { __typename ... on RepositoryLocation { repositories { name jobs { name } } } } } } } }",
                legacy=("query { repositoriesOrError { __typename ... on RepositoryConnection { nodes { name "
                        "location { name } pipelines { name } } } } }",),
            )
        elif t.endswith(".listAssets"):
            data = _gql(
                "query { assetsOrError { __typename ... on AssetConnection { nodes { key { path } } } } }"
            )
        elif t.endswith(".launchRun") or t.endswith(".materialize"):
            assets = parse_jsonish(cfg.get("assets") or selector.get("assetSelection"), default=None)
            if t.endswith(".materialize") and assets and not job_name:
                job_name = "__ASSET_JOB"
            if not job_name:
                raise RuntimeError(f"{t} requires a job name (node Job ID or connector default job)")
            if not (repo and loc):
                # repositoryName / repositoryLocationName are String! — resolve them from the workspace
                repos = _dg_workspace_repos()
                match = [r for r in repos if job_name in r[2]] or (repos if len(repos) == 1 else [])
                if not match:
                    raise RuntimeError(
                        f"Dagster job {job_name!r} not found — set the connector code location and repository "
                        f"(available: {[(r[0], r[1]) for r in repos]})"
                    )
                loc, repo = loc or str(match[0][0]), repo or str(match[0][1])
            params: dict[str, Any] = {
                "selector": {"jobName": job_name, "repositoryName": repo, "repositoryLocationName": loc},
            }
            if assets:
                paths = assets if isinstance(assets, list) else [assets]
                params["selector"]["assetSelection"] = [
                    {"path": p if isinstance(p, list) else str(p).split("/")} for p in paths
                ]
            run_config = parse_jsonish(cfg.get("runConfig") or selector.get("runConfigData"), default=None)
            if run_config:
                params["runConfigData"] = run_config
            legacy_params = {
                "selector": {"pipelineName": job_name, "repositoryName": repo, "repositoryLocationName": loc},
                **({"runConfigData": run_config} if run_config else {}),
            }
            data = _gql(
                "mutation($params: ExecutionParams!) { launchRun(executionParams: $params) { "
                "__typename ... on LaunchRunSuccess { run { runId status } } ... on Error { message } } }",
                {"params": params},
                legacy=("mutation($params: ExecutionParams!) { launchPipelineExecution(executionParams: $params) { "
                        "__typename ... on LaunchPipelineRunSuccess { run { runId status } } ... on Error { message } } }",
                        {"params": legacy_params}),
            )
            key = "launchRun" if "launchRun" in (data or {}) else "launchPipelineExecution"
            _dg_check(data, key, ("LaunchRunSuccess", "LaunchPipelineRunSuccess"))
            run = ((data or {}).get(key) or {}).get("run") or {}
            if run.get("runId"):
                data = {**data, "runId": run.get("runId"), "status": run.get("status")}
        elif t.endswith(".runStatus"):
            if not run_id:
                raise RuntimeError("dagster.runStatus requires a run ID (node Run ID or upstream $json.runId)")
            data = _gql(
                "query($id: ID!) { runOrError(runId: $id) { __typename ... on Run { runId status jobName } ... on Error { message } } }",
                {"id": run_id},
                legacy=("query($id: ID!) { pipelineRunOrError(runId: $id) { __typename ... on PipelineRun { runId status pipelineName } ... on Error { message } } }",),
            )
            key = "runOrError" if "runOrError" in (data or {}) else "pipelineRunOrError"
            _dg_check(data, key, ("Run", "PipelineRun"))
            node = (data or {}).get(key) or {}
            data = {**data, "runId": node.get("runId"), "status": node.get("status")}
        elif t.endswith(".terminate"):
            if not run_id:
                raise RuntimeError("dagster.terminate requires a run ID (node Run ID or upstream $json.runId)")
            data = _gql(
                "mutation($id: String!) { terminateRun(runId: $id) { __typename ... on TerminateRunSuccess { run { runId status } } ... on TerminateRunFailure { message } ... on PythonError { message } } }",
                {"id": run_id},
                legacy=("mutation($id: String!) { terminatePipelineExecution(runId: $id) { __typename ... on TerminatePipelineExecutionSuccess { run { runId status } } ... on TerminatePipelineExecutionFailure { message } ... on PythonError { message } } }",),
            )
            key = "terminateRun" if "terminateRun" in (data or {}) else "terminatePipelineExecution"
            _dg_check(data, key, ("TerminateRunSuccess", "TerminatePipelineExecutionSuccess"))
        elif t.endswith(".sensorTick"):
            # sensorsOrError needs a repositorySelector; the workspace query works without one
            ws = _gql(
                "query { workspaceOrError { __typename ... on Workspace { locationEntries { name "
                "locationOrLoadError { __typename ... on RepositoryLocation { repositories { name "
                "sensors { name sensorState { status } } } } } } } } }"
            )
            rows = []
            for entry in (((ws or {}).get("workspaceOrError") or {}).get("locationEntries")) or []:
                for r in ((entry or {}).get("locationOrLoadError") or {}).get("repositories") or []:
                    for s in r.get("sensors") or []:
                        rows.append({"location": entry.get("name"), "repository": r.get("name"),
                                     "sensor": s.get("name"), "status": (s.get("sensorState") or {}).get("status")})
            return _emit_plugin(task, {"ok": True, "op": t, "rows": rows or [{"sensors": 0}], "body": ws})
        else:
            raise RuntimeError(f"Unsupported dagster node: {t}")
        rows = [data] if isinstance(data, dict) else [{"result": data}]
        return _emit_plugin(task, {"ok": True, "op": t, "rows": rows, "body": data})
    if t.startswith("flink."):
        import os

        base = _connector_base_url(cfg, "http://127.0.0.1:8081")
        upstream = _rows_from_task_inputs(task)
        first_up = upstream[0] if upstream and isinstance(upstream[0], dict) else {}
        job_id = str(
            cfg.get("jobId")
            or cfg.get("runId")
            or cfg.get("resourceName")
            or first_up.get("jobid")
            or first_up.get("jid")
            or first_up.get("jobId")
            or ""
        ).strip()

        def _need_job(op: str) -> str:
            if not job_id:
                raise RuntimeError(
                    f"flink.{op} requires a Job ID (node Job ID / Resource name, or upstream $json.jobid)"
                )
            return urllib.parse.quote(job_id, safe="")

        if t.endswith(".listJobs"):
            data = http_json(base + "/jobs/overview", "GET", headers)
        elif t.endswith(".jarList"):
            data = http_json(base + "/jars", "GET", headers)
            files = data.get("files") if isinstance(data, dict) else None
            if isinstance(files, list):
                rows = [
                    {"id": f.get("id"), "name": f.get("name"), "uploaded": f.get("uploaded"),
                     "entryClass": ((f.get("entry") or [{}])[0] or {}).get("name")}
                    for f in files if isinstance(f, dict)
                ]
                return _emit_plugin(task, {"ok": True, "op": t, "rows": rows or [{"jars": 0}], "body": data})
        elif t.endswith(".jobStatus"):
            data = http_json(f"{base}/jobs/{_need_job('jobStatus')}", "GET", headers)
        elif t.endswith(".cancel"):
            # Flink REST: PATCH /jobs/:jobid?mode=cancel (yarn-cancel was removed)
            data = http_json(f"{base}/jobs/{_need_job('cancel')}?mode=cancel", "PATCH", headers)
            data = {"jobid": job_id, "cancelled": True, **(data if isinstance(data, dict) else {})}
        elif t.endswith(".savepoint"):
            body: dict[str, Any] = {"cancel-job": bool(cfg.get("cancelJob") or False)}
            target_dir = cfg.get("targetDirectory") or cfg.get("savepointDir") or cfg.get("path")
            if target_dir:
                body["target-directory"] = str(target_dir)
            if cfg.get("formatType"):
                body["formatType"] = str(cfg.get("formatType")).upper()  # Flink 1.15+ (CANONICAL / NATIVE)
            data = http_json(f"{base}/jobs/{_need_job('savepoint')}/savepoints", "POST", headers, body)
            data = {"jobid": job_id, **(data if isinstance(data, dict) else {"result": data})}
            trigger_id = data.get("request-id")
            if trigger_id and cfg.get("wait", True) not in (False, "false"):
                # Savepoints are asynchronous on every Flink version — poll for the location
                deadline = time.time() + float(cfg.get("timeoutSec") or 120)
                while time.time() < deadline:
                    status = http_json(
                        f"{base}/jobs/{_need_job('savepoint')}/savepoints/{urllib.parse.quote(str(trigger_id), safe='')}",
                        "GET", headers,
                    )
                    if isinstance(status, dict) and ((status.get("status") or {}).get("id") == "COMPLETED"):
                        op = status.get("operation") or {}
                        if op.get("failure-cause"):
                            raise RuntimeError(f"Flink savepoint failed: {op.get('failure-cause')}")
                        data.update({"status": "COMPLETED", "location": op.get("location")})
                        break
                    time.sleep(1)
                else:
                    data["status"] = "IN_PROGRESS"
        elif t.endswith(".submit"):
            jar = str(
                cfg.get("jarId")
                or cfg.get("resourceName")
                or cfg.get("jobId")
                or first_up.get("id")
                or cfg.get("jobJar")
                or ""
            ).strip()
            if jar.lower().endswith(".jar") and os.path.isfile(jar):
                jar = _flink_upload_jar(base, headers, jar)
            elif "/" in jar:
                # Flink JAR ids are the bare upload name (e.g. <uuid>_job.jar)
                jar = jar.rsplit("/", 1)[-1]
            if not jar:
                listed = http_json(base + "/jars", "GET", headers)
                ids = [f.get("id") for f in (listed or {}).get("files", []) if isinstance(f, dict)]
                raise RuntimeError(
                    "flink.submit requires a JAR ID (node Job ID / jarId, a local .jar path, or upstream flink.jarList $json.id). "
                    f"Uploaded jars: {', '.join(str(i) for i in ids) or '(none)'}"
                )
            run_body = parse_jsonish(cfg.get("parameters"), default={}) or {}
            if not isinstance(run_body, dict):
                run_body = {}
            for src, dst in (("entryClass", "entryClass"), ("programArgs", "programArgs"), ("savepointPath", "savepointPath")):
                if cfg.get(src) not in (None, "") and dst not in run_body:
                    run_body[dst] = cfg.get(src)
            if cfg.get("parallelism") not in (None, "") and "parallelism" not in run_body:
                run_body["parallelism"] = int(cfg.get("parallelism"))
            if isinstance(run_body.get("programArgs"), str) and "programArgsList" not in run_body:
                # programArgs is deprecated since Flink 1.7 (removed in 2.x); programArgsList works on both
                import shlex

                run_body["programArgsList"] = shlex.split(run_body.pop("programArgs"))
            data = http_json(f"{base}/jars/{urllib.parse.quote(jar, safe='')}/run", "POST", headers, run_body)
            data = {"jarId": jar, **(data if isinstance(data, dict) else {"result": data})}
            if data.get("jobid"):
                data["jobId"] = data["jobid"]
        elif t.endswith(".rescale"):
            parallelism = int(cfg.get("parallelism") or cfg.get("newParallelism") or 1)
            # Flink REST takes parallelism as a query parameter, not a JSON body
            try:
                data = http_json(
                    f"{base}/jobs/{_need_job('rescale')}/rescaling?parallelism={parallelism}",
                    "PATCH",
                    headers,
                )
            except RuntimeError as exc:
                if not any(c in str(exc) for c in ("HTTP 404", "HTTP 405", "HTTP 503", "disabled")):
                    raise
                # Legacy rescaling is disabled (Flink 1.9+) / removed (2.x) — adaptive scheduler API
                try:
                    reqs = http_json(f"{base}/jobs/{_need_job('rescale')}/resource-requirements", "GET", headers)
                except RuntimeError as exc2:
                    raise RuntimeError(
                        "Flink rescale is not available on this cluster: the legacy /rescaling endpoint is "
                        "disabled and the adaptive scheduler (jobmanager.scheduler: adaptive, Flink 1.18+) "
                        "is not enabled. Take a savepoint and resubmit with the new parallelism."
                    ) from exc2
                if isinstance(reqs, dict):
                    for vertex in reqs.values():
                        if isinstance(vertex, dict) and isinstance(vertex.get("parallelism"), dict):
                            vertex["parallelism"]["upperBound"] = parallelism
                http_json(f"{base}/jobs/{_need_job('rescale')}/resource-requirements", "PUT", headers, reqs)
                data = {"mode": "adaptive-scheduler"}
            data = {"jobid": job_id, "parallelism": parallelism, **(data if isinstance(data, dict) else {"result": data})}
        else:
            raise RuntimeError(f"Unsupported flink node: {t}")
        rows = data.get("jobs") if isinstance(data, dict) and isinstance(data.get("jobs"), list) else ([data] if isinstance(data, dict) else [{"result": data}])
        return _emit_plugin(task, {"ok": True, "op": t, "rows": rows, "body": data})
    if t.startswith("dbt."):
        mode = str(cfg.get("mode") or blob.get("mode") or "").lower()
        project_dir = str(cfg.get("projectDir") or cfg.get("path") or "").strip()
        cause = t.split(".", 1)[-1]
        if mode in ("core", "cli", "local") or (project_dir and not (cfg.get("jobId") or blob.get("accountId"))):
            import shutil
            import subprocess

            if cause == "jobStatus":
                # dbt Core has no "jobStatus" command — report the last invocation's run_results.json
                results_path = Path(
                    str(cfg.get("runResultsPath") or "")
                    or str(Path(project_dir or ".") / str(cfg.get("targetPath") or "target") / "run_results.json")
                )
                if not results_path.is_file():
                    raise RuntimeError(
                        f"dbt.jobStatus (Core) reads {results_path} — run dbt run/test/build first "
                        "or set connector mode to cloud with accountId + runId"
                    )
                doc = json.loads(results_path.read_text(encoding="utf-8"))
                rows, summary = _dbt_results_rows(doc)
                return _emit_plugin(task, {"ok": True, "op": t, "rows": rows or [summary], **summary})

            exe = str(cfg.get("dbtPath") or cfg.get("executable") or "").strip() or shutil.which("dbt") or shutil.which("dbtf") or "dbt"
            version = _dbt_core_version(exe)
            # Profile target comes from the connector — node "target" fields name tables
            cmd = _dbt_core_command(
                exe, cause, {**cfg, "profileTarget": cfg.get("profileTarget") or _cc.get("target")}, version
            )
            started = time.time()
            proc = subprocess.run(  # noqa: S603
                cmd,
                cwd=project_dir or None,
                capture_output=True,
                text=True,
                timeout=float(cfg.get("timeoutSec") or 600),
            )
            results_path = Path(project_dir or ".") / str(cfg.get("targetPath") or "target") / "run_results.json"
            rows: list[dict] = []
            summary: dict[str, Any] = {}
            if results_path.is_file() and results_path.stat().st_mtime >= started - 1:
                try:
                    rows, summary = _dbt_results_rows(json.loads(results_path.read_text(encoding="utf-8")))
                except (OSError, ValueError):
                    rows, summary = [], {}
            tail = (proc.stdout or "")[-4000:]
            # dbt exit codes (all versions): 0 ok, 1 model/test failures, 2 invocation error
            if proc.returncode != 0 and (proc.returncode != 1 or cfg.get("failOnError", True)):
                raise RuntimeError(
                    f"dbt {cause} exited {proc.returncode} (dbt {version.get('version') or 'unknown'}): "
                    + (proc.stderr or proc.stdout or "")[-4000:]
                )
            summary = {
                **summary,
                "exitCode": proc.returncode,
                "dbt_version": version.get("version"),
                "engine": version.get("engine"),
                "command": " ".join(cmd[1:]),
                "cwd": project_dir or None,
            }
            return _emit_plugin(task, {
                "ok": True, "op": t,
                "rows": rows or [{**summary, "stdout": tail}],
                **summary,
            })
        api = _dbt_cloud_api_base(cfg)
        cloud_headers = {k: v for k, v in headers.items() if k.lower() != "authorization"}
        cloud_token = (
            blob.get("apiToken") or blob.get("token") or blob.get("DBT_CLOUD_API_TOKEN")
            or cfg.get("apiToken") or cfg.get("token")
        )
        if cloud_token:
            tok = str(cloud_token)
            cloud_headers["Authorization"] = tok if tok.lower().startswith(("token ", "bearer ")) else f"Token {tok}"
        elif headers.get("Authorization"):
            cloud_headers["Authorization"] = headers["Authorization"]
        account = str(cfg.get("accountId") or blob.get("accountId") or cfg.get("scope") or "").strip()
        if not account:
            raise RuntimeError("dbt Cloud requires the connector account ID")
        upstream = _rows_from_task_inputs(task)
        first_up = upstream[0] if upstream and isinstance(upstream[0], dict) else {}
        if t.endswith(".jobStatus"):
            run_id = str(
                cfg.get("runId") or cfg.get("resourceName") or first_up.get("run_id")
                or first_up.get("runId") or first_up.get("id") or ""
            ).strip()
            if not run_id:
                raise RuntimeError("dbt.jobStatus (Cloud) requires a run ID (node Run ID or upstream dbt.run $json.run_id)")
            data = http_json(f"{api}/accounts/{account}/runs/{urllib.parse.quote(run_id, safe='')}/", "GET", cloud_headers)
        elif cause in ("run", "test", "build", "seed", "snapshot", "compile", "docs"):
            job_id = str(cfg.get("jobId") or "").strip()
            if not job_id:
                raise RuntimeError(f"dbt.{cause} (Cloud) requires the Cloud job ID")
            body = parse_jsonish(cfg.get("parameters"), default={}) or {}
            if not isinstance(body, dict):
                body = {}
            body.setdefault("cause", f"Triggered by Agent Studio ({cause})")
            data = http_json(
                f"{api}/accounts/{account}/jobs/{urllib.parse.quote(job_id, safe='')}/run/",
                "POST",
                cloud_headers,
                body,
            )
        else:
            raise RuntimeError(f"Unsupported dbt node: {t}")
        row = _dbt_cloud_run_row(data)
        return _emit_plugin(task, {"ok": True, "op": t, "rows": [row], "body": data})
    if t.startswith("temporal."):
        try:
            from temporalio.client import Client  # type: ignore
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"temporalio is required for temporal.* nodes: pip install temporalio ({exc})") from exc
        import asyncio

        target = str(cfg.get("address") or cfg.get("host") or cfg.get("url") or "localhost:7233")
        target = target.replace("http://", "").replace("https://", "").rstrip("/")
        ns = str(cfg.get("scope") or cfg.get("namespace") or "default")
        wf = str(cfg.get("jobId") or cfg.get("workflowId") or cfg.get("resourceName") or "")
        workflow_type = str(cfg.get("workflowType") or cfg.get("name") or wf or "Workflow")
        task_queue = str(cfg.get("taskQueue") or cfg.get("queue") or "default")
        params = parse_jsonish(cfg.get("parameters"), default=None)
        signal_name = str(cfg.get("signal") or cfg.get("resourceName") or "signal")
        query_name = str(cfg.get("query") or "status")

        def _pem(value: Any) -> bytes:
            text = str(value)
            if "-----BEGIN" not in text and Path(text).expanduser().is_file():
                return Path(text).expanduser().read_bytes()
            return text.encode("utf-8")

        def _status_name(value: Any) -> str:
            # WorkflowExecutionStatus is an IntEnum: str() is "1" on Python 3.11+, the member path before
            return str(getattr(value, "name", None) or value or "")

        async def _connect() -> Any:
            kw: dict[str, Any] = {"namespace": ns}
            api_key = blob.get("apiKey") or cfg.get("apiKey")
            cert = blob.get("tlsCert") or cfg.get("tlsCert")
            key = blob.get("tlsKey") or cfg.get("tlsKey")
            if cert and key:
                from temporalio.service import TLSConfig  # type: ignore

                kw["tls"] = TLSConfig(client_cert=_pem(cert), client_private_key=_pem(key))
            elif api_key:
                kw["tls"] = True
            if api_key:
                try:
                    return await Client.connect(target, api_key=str(api_key), **kw)
                except TypeError:
                    # temporalio < 1.7 has no api_key kwarg — send it as gRPC metadata
                    return await Client.connect(
                        target, rpc_metadata={"authorization": f"Bearer {api_key}"}, **kw
                    )
            return await Client.connect(target, **kw)

        async def _temporal() -> list[dict]:
            client = await _connect()
            if t.endswith(".list"):
                if not hasattr(client, "list_workflows"):
                    raise RuntimeError("temporal.list needs temporalio >= 1.1 (Client.list_workflows)")
                out = []
                list_query = cfg.get("listQuery") or cfg.get("visibilityQuery")
                iterator = client.list_workflows(str(list_query)) if list_query else client.list_workflows()
                async for info in iterator:
                    out.append({"id": getattr(info, "id", None), "run_id": getattr(info, "run_id", None), "status": _status_name(getattr(info, "status", ""))})
                    if len(out) >= int(cfg.get("limit") or 50):
                        break
                return out
            if t.endswith(".startWorkflow"):
                start_kw: dict[str, Any] = {"id": wf or workflow_type, "task_queue": task_queue}
                if params is not None:
                    start_kw["arg"] = params  # arg=None would send one null argument
                handle = await client.start_workflow(workflow_type, **start_kw)
                return [{"workflow_id": handle.id, "run_id": handle.result_run_id}]
            if not wf:
                raise RuntimeError(f"{t} requires workflowId / jobId")
            handle = client.get_workflow_handle(wf)
            if t.endswith(".describe"):
                desc = await handle.describe()
                return [{"id": wf, "status": _status_name(getattr(desc, "status", "")), "run_id": getattr(desc, "run_id", None)}]
            if t.endswith(".signal"):
                if params is None:
                    await handle.signal(signal_name)
                else:
                    await handle.signal(signal_name, params)
                return [{"signaled": True, "name": signal_name, "id": wf}]
            if t.endswith(".query"):
                result = await (handle.query(query_name) if params is None else handle.query(query_name, params))
                return [{"id": wf, "query": query_name, "result": result}]
            if t.endswith(".cancel"):
                await handle.cancel()
                return [{"cancelled": True, "id": wf}]
            if t.endswith(".terminate"):
                await handle.terminate(reason=str(cfg.get("reason") or "studio terminate"))
                return [{"terminated": True, "id": wf}]
            raise RuntimeError(f"Unsupported temporal node: {t}")

        rows = asyncio.run(_temporal())
        return _emit_plugin(task, {"ok": True, "op": t, "rows": rows})
    if t.startswith("great_expectations."):
        try:
            import great_expectations as gx  # type: ignore
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"great_expectations is required for GX nodes: {exc}") from exc
        root = str(cfg.get("contextRoot") or cfg.get("projectRoot") or cfg.get("path") or "")
        if root:
            try:
                context = gx.get_context(project_root_dir=root)
            except TypeError:
                context = gx.get_context(context_root_dir=root)
        else:
            context = gx.get_context()
        gx_version = str(getattr(gx, "__version__", ""))

        def _gx_result_row(result: Any) -> dict:
            if hasattr(result, "to_json_dict"):
                payload = result.to_json_dict()
            elif hasattr(result, "describe_dict"):
                payload = result.describe_dict()  # GX 1.x CheckpointResult / ValidationResult
            else:
                payload = result
            if not isinstance(payload, dict):
                # never let an unknown result shape pass a failOnError check silently
                return {"success": getattr(result, "success", None), "result": str(payload), "gx_version": gx_version}
            if payload.get("success") is None and hasattr(result, "success"):
                payload = {**payload, "success": getattr(result, "success")}
            row = {"success": payload.get("success")}
            stats = payload.get("statistics")
            if isinstance(stats, dict):
                row.update({k: v for k, v in stats.items() if not isinstance(v, (dict, list))})
            row["gx_version"] = gx_version
            row["result"] = payload
            return row

        if t.endswith(".listSuites"):
            if hasattr(context, "suites"):
                names = [getattr(s, "name", str(s)) for s in context.suites.all()]
            else:
                names = list(getattr(context, "list_expectation_suite_names", lambda: [])() or [])
            return _emit_plugin(task, {"ok": True, "op": t, "rows": [{"suite": n} for n in names] or [{"suites": 0}]})
        if t.endswith(".listCheckpoints"):
            if hasattr(context, "checkpoints"):
                names = [getattr(c, "name", str(c)) for c in context.checkpoints.all()]
            else:
                names = list(getattr(context, "list_checkpoints", lambda: [])() or [])
            return _emit_plugin(task, {"ok": True, "op": t, "rows": [{"checkpoint": n} for n in names] or [{"checkpoints": 0}]})
        if t.endswith(".checkpoint") or t.endswith(".validate"):
            # Validate/Checkpoint nodes expose the name as "Suite / checkpoint / select"
            name = str(
                cfg.get("checkpoint")
                or cfg.get("suite")
                or cfg.get("jobId")
                or cfg.get("resourceName")
                or ""
            ).strip()
            if not name:
                raise RuntimeError(f"{t} requires a checkpoint name (Suite / checkpoint field)")
            if hasattr(context, "checkpoints"):
                # GX 1.x — validation definition first for .validate, else checkpoint
                runner = None
                if t.endswith(".validate") and hasattr(context, "validation_definitions"):
                    try:
                        runner = context.validation_definitions.get(name)
                    except Exception:  # noqa: BLE001
                        runner = None
                if runner is None:
                    runner = context.checkpoints.get(name)
                result = runner.run()
            else:
                result = context.run_checkpoint(checkpoint_name=name)
            row = {"checkpoint": name, **_gx_result_row(result)}
            if cfg.get("failOnError", True) and row.get("success") is False:
                raise RuntimeError(f"Great Expectations {name} failed validation: {row.get('unsuccessful_expectations')} failing")
            return _emit_plugin(task, {"ok": True, "op": t, "rows": [row]})
        if t.endswith(".docs"):
            context.build_data_docs()
            return _emit_plugin(task, {"ok": True, "op": t, "rows": [{"built": True}]})
        if t.endswith(".createSuite") or t.endswith(".profile"):
            name = str(
                cfg.get("resourceName")
                or cfg.get("suite")
                or ("profiled_suite" if t.endswith(".profile") else "studio_suite")
            )
            added: list[str] = []
            if hasattr(context, "suites"):
                # GX 1.x — ExpectationSuite objects via context.suites
                suite = gx.ExpectationSuite(name=name)
                if t.endswith(".profile"):
                    rows_in = _rows_from_task_inputs(task)
                    if not rows_in:
                        raise RuntimeError("great_expectations.profile needs upstream rows to profile")
                    columns = sorted({k for r in rows_in if isinstance(r, dict) for k in r.keys()})
                    for col in columns:
                        suite.add_expectation(gx.expectations.ExpectColumnToExist(column=col))
                        added.append(f"expect_column_to_exist:{col}")
                        if all(isinstance(r, dict) and r.get(col) is not None for r in rows_in):
                            suite.add_expectation(gx.expectations.ExpectColumnValuesToNotBeNull(column=col))
                            added.append(f"expect_column_values_to_not_be_null:{col}")
                try:
                    context.suites.delete(name)
                except Exception:  # noqa: BLE001
                    pass
                suite = context.suites.add(suite)
            elif hasattr(context, "add_or_update_expectation_suite"):
                suite = context.add_or_update_expectation_suite(expectation_suite_name=name)
            elif hasattr(context, "add_expectation_suite"):
                suite = context.add_expectation_suite(expectation_suite_name=name)
            elif hasattr(context, "create_expectation_suite"):
                suite = context.create_expectation_suite(expectation_suite_name=name, overwrite_existing=True)
            else:
                raise RuntimeError(f"Great Expectations {gx_version} exposes no suite-creation API")
            row = {
                "suite": name,
                "expectations": len(getattr(suite, "expectations", []) or []),
                "gx_version": gx_version,
            }
            if added:
                row["profiled"] = added
            return _emit_plugin(task, {"ok": True, "op": t, "rows": [row]})
        raise RuntimeError(f"Unsupported GX node: {t}")
    raise RuntimeError(f"No HTTP product handler for {t}")


def handle_bigquery(task: dict, ctx: dict) -> dict:
    t = str(task.get("type") or "")
    _conn, _cc, blob, cfg = _connector_bundle(task, ctx)
    try:
        from google.cloud import bigquery as bq  # type: ignore
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"google-cloud-bigquery is required for bigquery.* nodes: {exc}") from exc
    project = str(cfg.get("project") or cfg.get("projectId") or cfg.get("scope") or blob.get("project") or blob.get("projectId") or "")
    creds = _gcp_credentials(blob, cfg)
    if creds and not project:
        # bq.Client does not read project_id from explicit service-account credentials
        project = str(getattr(creds, "project_id", "") or "")
    client = bq.Client(project=project or None, credentials=creds) if creds else bq.Client(project=project or None)
    project = project or getattr(client, "project", "") or ""
    if not project:
        raise RuntimeError("bigquery.* requires connector project / projectId")
    dataset = str(cfg.get("database") or cfg.get("dataset") or "")
    table = str(cfg.get("target") or cfg.get("table") or cfg.get("resourceName") or "")
    sql = str(cfg.get("sql") or cfg.get("query") or cfg.get("statement") or "").strip()
    fqn = f"{project}.{dataset}.{table}" if dataset and table else table
    if t.endswith(".query") or t.endswith(".execute"):
        if not sql:
            sql = ("SELECT * FROM " + chr(96) + fqn + chr(96)) if fqn else "SELECT 1"
        job = client.query(sql)
        result = job.result()
        rows = [dict(r) for r in result]
        return _emit_plugin(task, {"ok": True, "op": t, "rows": rows, "job": getattr(job, "job_id", None)})
    if t.endswith(".listTables"):
        if not dataset:
            # list_tables needs a dataset — without one, list the project's datasets
            datasets = list(client.list_datasets(project))
            return _emit_plugin(task, {"ok": True, "op": t, "rows": [{"dataset": d.dataset_id, "project": project} for d in datasets] or [{"datasets": 0}]})
        tables = list(client.list_tables(f"{project}.{dataset}" if "." not in dataset else dataset))
        return _emit_plugin(task, {"ok": True, "op": t, "rows": [{"table": tb.table_id, "dataset": tb.dataset_id} for tb in tables]})
    if t.endswith(".schema"):
        tbl = client.get_table(fqn)
        return _emit_plugin(task, {"ok": True, "op": t, "rows": [{"name": f.name, "type": f.field_type, "mode": f.mode} for f in (tbl.schema or [])]})
    if t.endswith(".createDataset"):
        ds_id = dataset or str(cfg.get("resourceName") or "")
        ds = client.create_dataset(ds_id, exists_ok=True)
        return _emit_plugin(task, {"ok": True, "op": t, "rows": [{"dataset": ds.dataset_id}]})
    if t.endswith(".insert"):
        rows_in = _rows_from_task_inputs(task)
        if not rows_in:
            raise RuntimeError("bigquery.insert needs upstream rows")
        errors = client.insert_rows_json(fqn, rows_in)
        if errors:
            raise RuntimeError(f"BigQuery insert errors: {errors}")
        return _emit_plugin(task, {"ok": True, "op": t, "rows": [{"inserted": len(rows_in)}]})
    if t.endswith(".createTable"):
        tbl = bq.Table(fqn)
        created = client.create_table(tbl, exists_ok=True)
        return _emit_plugin(task, {"ok": True, "op": t, "rows": [{"table": created.table_id, "dataset": created.dataset_id}]})
    if t.endswith(".load"):
        src = str(cfg.get("path") or cfg.get("source") or cfg.get("uri") or "")
        if not src:
            raise RuntimeError("bigquery.load requires path/source URI (gs://...)")
        job_config = bq.LoadJobConfig(source_format=bq.SourceFormat.NEWLINE_DELIMITED_JSON, autodetect=True)
        job = client.load_table_from_uri(src, fqn, job_config=job_config)
        job.result()
        return _emit_plugin(task, {"ok": True, "op": t, "rows": [{"table": fqn, "source": src, "job": job.job_id}]})
    if t.endswith(".extract"):
        dest = str(cfg.get("path") or cfg.get("destination") or cfg.get("uri") or "")
        if not dest:
            raise RuntimeError("bigquery.extract requires destination URI (gs://...)")
        job = client.extract_table(fqn, dest)
        job.result()
        return _emit_plugin(task, {"ok": True, "op": t, "rows": [{"table": fqn, "destination": dest, "job": job.job_id}]})
    raise RuntimeError(f"Unsupported bigquery node: {t}")


def handle_databricks_ops(task: dict, ctx: dict) -> dict:
    t = str(task.get("type") or "")
    _conn, _cc, blob, cfg = _connector_bundle(task, ctx)
    host = _connector_base_url(cfg)
    if not host:
        raise RuntimeError("Databricks host/url missing on connector")
    headers = _http_auth_headers(blob, cfg)
    if t.endswith(".notebook"):
        path = str(cfg.get("target") or cfg.get("resourceName") or cfg.get("path") or "")
        nb_task: dict[str, Any] = {"task_key": "nb", "notebook_task": {"notebook_path": path}}
        cluster_id = cfg.get("clusterId") or cfg.get("existingClusterId") or blob.get("clusterId")
        if cluster_id:
            # workspaces without serverless jobs need a cluster on runs/submit
            nb_task["existing_cluster_id"] = str(cluster_id)
        data = http_json(host + "/api/2.1/jobs/runs/submit", "POST", headers, {"run_name": "studio", "tasks": [nb_task]})
        return _emit_plugin(task, {"ok": True, "op": t, "rows": [data] if isinstance(data, dict) else [{"result": data}]})
    if "jobStatus" in t:
        run_id = str(cfg.get("runId") or cfg.get("jobId") or "")
        data = http_json(host + f"/api/2.1/jobs/runs/get?run_id={urllib.parse.quote(run_id)}", "GET", headers)
        return _emit_plugin(task, {"ok": True, "op": t, "rows": [data] if isinstance(data, dict) else [{"result": data}]})
    if t.endswith(".volume") or t.endswith(".dbfs"):
        path = str(cfg.get("target") or cfg.get("path") or cfg.get("resourceName") or "/")
        mode = str(cfg.get("mode") or cfg.get("operation") or "").lower()
        rows_in = _rows_from_task_inputs(task)
        if path.startswith("/Volumes/"):
            # Unity Catalog volumes are not on DBFS — use the Files API (2.0 /fs)
            fs_url = host + "/api/2.0/fs/files" + urllib.parse.quote(path)
            if mode in ("write", "put") or (rows_in and mode not in ("read", "get", "list")):
                body = json.dumps(rows_in or cfg.get("value") or {}, default=str).encode("utf-8")
                req = urllib.request.Request(
                    fs_url + "?overwrite=true", data=body, method="PUT",
                    headers={**headers, "Content-Type": "application/octet-stream"},
                )
                with urllib.request.urlopen(req, timeout=120) as resp:  # noqa: S310
                    resp.read()
                return _emit_plugin(task, {"ok": True, "op": t, "rows": [{"path": path, "bytes": len(body)}]})
            if mode in ("read", "get"):
                req = urllib.request.Request(fs_url, method="GET", headers=headers)
                with urllib.request.urlopen(req, timeout=120) as resp:  # noqa: S310
                    text = resp.read().decode("utf-8", errors="replace")
                try:
                    parsed = json.loads(text) if text else []
                    rows = parsed if isinstance(parsed, list) else [parsed]
                except Exception:  # noqa: BLE001
                    rows = [{"content": text[:8000], "path": path}]
                return _emit_plugin(task, {"ok": True, "op": t, "rows": normalize_rows(rows)})
            data = http_json(host + "/api/2.0/fs/directories" + urllib.parse.quote(path), "GET", headers)
            entries = data.get("contents") if isinstance(data, dict) else None
            return _emit_plugin(task, {"ok": True, "op": t, "rows": entries if isinstance(entries, list) else [data]})
        if mode in ("write", "put") or (rows_in and mode not in ("read", "get", "list")):
            body = json.dumps(rows_in or cfg.get("value") or {}, default=str)
            data = http_json(
                host + "/api/2.0/dbfs/put",
                "POST",
                headers,
                {"path": path, "contents": base64.b64encode(body.encode("utf-8")).decode("ascii"), "overwrite": True},
            )
            return _emit_plugin(task, {"ok": True, "op": t, "rows": [{"path": path, "bytes": len(body), "result": data}]})
        if mode in ("read", "get"):
            data = http_json(host + "/api/2.0/dbfs/read?" + urllib.parse.urlencode({"path": path}), "GET", headers)
            raw = base64.b64decode((data.get("data") if isinstance(data, dict) else None) or "")
            text = raw.decode("utf-8", errors="replace")
            try:
                parsed = json.loads(text) if text else []
                rows = parsed if isinstance(parsed, list) else [parsed]
            except Exception:  # noqa: BLE001
                rows = [{"content": text[:8000], "path": path}]
            return _emit_plugin(task, {"ok": True, "op": t, "rows": normalize_rows(rows)})
        data = http_json(host + "/api/2.0/dbfs/list?" + urllib.parse.urlencode({"path": path}), "GET", headers)
        files = data.get("files") if isinstance(data, dict) else data
        return _emit_plugin(task, {"ok": True, "op": t, "rows": files if isinstance(files, list) else [data]})
    return handle_sqlish_read(task, ctx)


def handle_de_plugin(task: dict, ctx: dict) -> dict:
    t = str(task.get("type") or "")
    if t.startswith("redis."):
        return handle_redis(task, ctx)
    if t.startswith("kafka."):
        return handle_kafka(task, ctx)
    if t.startswith("gcs.") or t.startswith("azure_blob."):
        return handle_object_store(task, ctx)
    if t.startswith("elasticsearch."):
        return handle_elasticsearch_write(task, ctx)
    if t.startswith("neo4j."):
        return handle_neo4j(task, ctx)
    if t.startswith("bigquery."):
        return handle_bigquery(task, ctx)
    if t.startswith("databricks.") and any(x in t for x in (".notebook", "jobStatus", ".volume", ".dbfs")):
        return handle_databricks_ops(task, ctx)
    if t.startswith(("airbyte.", "nifi.", "dagster.", "flink.", "dbt.", "temporal.", "great_expectations.")):
        return handle_http_product(task, ctx)
    raise RuntimeError(f"No data-engineering handler for {t}")
`;
}
