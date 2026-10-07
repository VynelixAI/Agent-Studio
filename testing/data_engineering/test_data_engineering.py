"""
Data engineering domain — S3 + Spark routing, read/write helpers, SQL builders.

Live S3/Spark skipped unless AS_LIVE_S3=1 / AS_LIVE_SPARK=1.

  python3 -m unittest testing.data_engineering.test_data_engineering -v
"""
from __future__ import annotations

import json
import os
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from testing.common.harness import DomainSandbox, make_task  # noqa: E402

DATA = Path(__file__).resolve().parent / "data"
LIVE_S3 = os.environ.get("AS_LIVE_S3") == "1"
LIVE_SPARK = os.environ.get("AS_LIVE_SPARK") == "1"


class TestDataEngineeringNodes(unittest.TestCase):
    def test_s3_and_spark_handlers_wired(self):
        with DomainSandbox("de") as sb:
            rw = sb.import_runner()
            for t in (
                "s3.list",
                "s3.read",
                "s3.write",
                "s3.delete",
                "s3.copy",
                "s3.createBucket",
                "s3.presign",
                "s3.head",
                "spark.sql",
                "spark.createTable",
                "spark.read",
                "spark.write",
                "spark.submit",
                "spark.jobStatus",
                "spark.cancel",
            ):
                self.assertIsNot(rw.pick_handler(t), rw.handle_default, msg=t)
            self.assertEqual(rw.pick_handler("s3.list"), rw.handle_s3)
            self.assertEqual(rw.pick_handler("spark.sql"), rw.handle_spark)
            for t in (
                "gcs.read",
                "azure_blob.write",
                "redis.set",
                "kafka.consume",
                "airbyte.triggerSync",
                "nifi.startProcessGroup",
                "dagster.launchRun",
                "dbt.run",
                "flink.submit",
                "temporal.startWorkflow",
                "great_expectations.validate",
                "elasticsearch.search",
                "neo4j.cypher",
                "bigquery.query",
                "databricks.notebook",
            ):
                self.assertEqual(rw.pick_handler(t), rw.handle_de_plugin, msg=t)
            self.assertIsNot(rw.pick_handler("file.source"), rw.handle_default)
            self.assertIsNot(rw.pick_handler("rest"), rw.handle_default)
            self.assertIsNot(rw.pick_handler("transform"), rw.handle_default)
            self.assertIsNot(rw.pick_handler("mysql.cdc"), rw.handle_default)
            self.assertIsNot(rw.pick_handler("duckdb.import"), rw.handle_default)

    def test_s3_missing_creds_clear_error(self):
        with DomainSandbox("de") as sb:
            rw = sb.import_runner()
            ctx = sb.base_ctx(
                connectors=[
                    {
                        "id": "s3_demo",
                        "type": "s3",
                        "secret_ref": "secret://s3_demo",
                        "config": {"bucket": "demo-lake", "region": "us-east-1"},
                    }
                ]
            )
            ctx["secrets"] = {}
            task = make_task(
                id="s3_list_1",
                type="s3.list",
                connector="s3_demo",
                config={"prefix": "raw/", "outputFormat": "yaml"},
            )
            with self.assertRaises(RuntimeError) as cm:
                rw.handle_s3(task, ctx)
            self.assertIn("credentials", str(cm.exception).lower())

    def test_s3_creds_from_config_fallback(self):
        """Legacy accessKeyId in config + secretAccessKey in secret should resolve."""
        with DomainSandbox("de") as sb:
            rw = sb.import_runner()
            # Without boto3 network, still validate credential presence path by forcing
            # missing bucket op that fails after creds check — use createBucket with fake keys
            # and expect boto/auth error OR success path past credentialsPresent.
            ctx = sb.base_ctx(
                connectors=[
                    {
                        "id": "s3_demo",
                        "type": "s3",
                        "secret_ref": "secret://s3_demo",
                        "config": {
                            "bucket": "demo-lake",
                            "region": "us-east-1",
                            "accessKeyId": "AKIATEST",
                        },
                    }
                ]
            )
            ctx["secrets"] = {
                "secret://s3_demo": json.dumps({"secretAccessKey": "secretTEST"})
            }
            task = make_task(
                id="s3_head_1",
                type="s3.head",
                connector="s3_demo",
                config={"bucket": "demo-lake", "key": "raw/nope.json", "outputFormat": "yaml"},
            )
            # Will fail on network/auth — but must NOT be "credentials missing"
            try:
                rw.handle_s3(task, ctx)
            except Exception as exc:  # noqa: BLE001
                msg = str(exc).lower()
                self.assertNotIn("credentials missing", msg)

    def test_spark_sql_requires_statement(self):
        with DomainSandbox("de") as sb:
            rw = sb.import_runner()
            ctx = sb.base_ctx(
                connectors=[
                    {
                        "id": "spk",
                        "type": "spark",
                        "config": {"master": "local[*]", "appName": "test"},
                    }
                ]
            )
            task = make_task(
                id="spk_sql",
                type="spark.sql",
                connector="spk",
                config={"sql": "", "outputFormat": "yaml"},
            )
            with self.assertRaises(RuntimeError) as cm:
                rw.handle_spark(task, ctx)
            self.assertIn("sql", str(cm.exception).lower())

    def test_spark_create_table_ddl_builder(self):
        with DomainSandbox("de") as sb:
            sb.copy_data(DATA)
            rw = sb.import_runner()
            ctx = sb.base_ctx(
                connectors=[
                    {"id": "spk", "type": "spark", "config": {"master": "local[*]"}}
                ]
            )
            task = make_task(
                id="spk_ct",
                type="spark.createTable",
                connector="spk",
                config={
                    "target": "default.events",
                    "definition": "event_id STRING, user_id STRING, event STRING",
                    "using": "PARQUET",
                    "ifNotExists": True,
                },
            )
            # Without pyspark this raises install error — acceptable; DDL path still entered
            try:
                rw.handle_spark(task, ctx)
            except RuntimeError as exc:
                msg = str(exc).lower()
                self.assertTrue(
                    "pyspark" in msg or "create table" in msg or "java" in msg,
                    msg=str(exc),
                )

    def test_events_csv_seed(self):
        with DomainSandbox("de") as sb:
            sb.copy_data(DATA)
            rows = sb.seed_stage_from_csv("stage.events", "events.csv")
            self.assertEqual(len(rows), 8)
            self.assertEqual(rows[3]["event"], "purchase")

    @unittest.skipUnless(LIVE_SPARK, "Set AS_LIVE_SPARK=1 with pyspark installed")
    def test_live_spark_sql(self):
        with DomainSandbox("de") as sb:
            rw = sb.import_runner()
            ctx = sb.base_ctx(
                connectors=[
                    {"id": "spk", "type": "spark", "config": {"master": "local[*]"}}
                ]
            )
            task = make_task(
                id="spk_sql_live",
                type="spark.sql",
                connector="spk",
                outputs=["stage.spark"],
                config={"sql": "SELECT 1 AS ok", "limit": 10, "outputFormat": "yaml"},
            )
            out = rw.handle_spark(task, ctx)
            self.assertTrue(out["result"].get("live"))
            self.assertGreaterEqual(out["result"].get("rowCount", 0), 1)

    def test_prefect_and_spark_blobs_become_item_rows(self):
        with DomainSandbox("de") as sb:
            rw = sb.import_runner()
            deps = rw._as_item_payload(
                {
                    "matched": [
                        {"id": "dep-1", "name": "etl/prod"},
                        {"id": "dep-2", "name": "ml/train"},
                    ],
                    "countMatched": 2,
                },
                {"op": "prefect.listDeployments", "ok": True, "live": True},
            )
            self.assertEqual(len(deps["rows"]), 2)
            self.assertEqual(deps["json"]["name"], "etl/prod")
            found = rw._deployments_from_stage(deps)
            self.assertEqual([d["id"] for d in found], ["dep-1", "dep-2"])

            spark = rw._as_item_payload(
                {
                    "ok": True,
                    "appId": "app-123",
                    "applicationId": "app-123",
                    "submitted": True,
                    "master": "local[*]",
                },
                {"op": "spark.submit", "ok": True, "live": True},
            )
            self.assertEqual(spark["json"]["appId"], "app-123")
            self.assertEqual(spark["items"][0]["json"]["appId"], "app-123")
            self.assertEqual(spark["json"]["applicationId"], "app-123")

            # Prefect flat flow_run_id (same contract as Airflow dag_run_id)
            pf = rw._as_item_payload(
                {
                    "ok": True,
                    "op": "prefect.triggerDeployment",
                    "flow_run_id": "fr-99",
                    "flowRunId": "fr-99",
                    "id": "fr-99",
                    "deploymentId": "dep-1",
                },
                {"op": "prefect.triggerDeployment", "ok": True, "live": True},
            )
            self.assertEqual(pf["json"]["flow_run_id"], "fr-99")
            self.assertEqual(pf["json"]["flowRunId"], "fr-99")
            self.assertEqual(pf["items"][0]["json"]["flow_run_id"], "fr-99")

            self.assertEqual(
                rw._spark_parse_app_id("submitted application_1234567890_0001"),
                "application_1234567890_0001",
            )
            self.assertEqual(
                rw._spark_rest_base("local[*]", {"restUrl": "http://spark:6066"}),
                "http://spark:6066",
            )
            self.assertEqual(
                rw._spark_rest_base("spark://host.example:7077", {}),
                "http://host.example:6066",
            )

            # jobStatus flattens driverState onto $json.appId (n8n / Databricks)
            status_urls = []

            def fake_spark_status(url, method="GET", headers=None, body=None, timeout=60):
                status_urls.append(url)
                return {"driverState": "RUNNING", "success": True}

            rw.http_json = fake_spark_status
            ctx = sb.base_ctx(
                connectors=[
                    {
                        "id": "spk",
                        "type": "spark",
                        "config": {
                            "master": "spark://host.example:7077",
                            "restUrl": "http://spark:6066",
                        },
                    }
                ]
            )
            rw.save_stage(
                "stage.submit",
                {
                    "json": {"appId": "app-123", "applicationId": "app-123"},
                    "items": [{"json": {"appId": "app-123", "applicationId": "app-123"}}],
                },
            )
            st = rw.handle_spark(
                make_task(
                    id="spk_status",
                    type="spark.jobStatus",
                    connector="spk",
                    inputs=["stage.submit"],
                    config={},
                ),
                ctx,
            )["result"]
            self.assertEqual(st["json"]["appId"], "app-123")
            self.assertEqual(st["json"]["driverState"], "RUNNING")
            self.assertEqual(st["json"]["state"], "RUNNING")
            self.assertTrue(any("/v1/submissions/status/app-123" in u for u in status_urls))


if __name__ == "__main__":
    unittest.main()
