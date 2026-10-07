"""
Database domain — ClickHouse SQL resolve, Mongo routing, structured DB pick_handler.

Live DB calls are skipped unless AS_LIVE_DB=1 and services are up.

  python3 -m unittest testing.databases.test_databases -v
"""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from testing.common.harness import DomainSandbox, make_task  # noqa: E402

DATA = Path(__file__).resolve().parent / "data"
LIVE = os.environ.get("AS_LIVE_DB") == "1"


class TestDatabaseNodes(unittest.TestCase):
    def test_clickhouse_sql_resolve_create_truncate(self):
        with DomainSandbox("databases") as sb:
            rw = sb.import_runner()
            create_db = rw._resolve_clickhouse_sql(
                {"type": "clickhouse.createDatabase"},
                {"resourceName": "analytics", "ifNotExists": True},
                None,
            )
            self.assertIn("CREATE DATABASE", create_db)
            self.assertIn("analytics", create_db)

            create_tbl = rw._resolve_clickhouse_sql(
                {"type": "clickhouse.createTable"},
                {
                    "database": "default",
                    "target": "crypto_ticks",
                    "definition": "symbol String, price Float64, volume Float64, ts DateTime",
                    "ifNotExists": True,
                },
                None,
            )
            self.assertIn("CREATE TABLE", create_tbl)
            self.assertIn("crypto_ticks", create_tbl)

            # Nested plugin-template shape
            trunc = rw._resolve_clickhouse_sql(
                {"type": "clickhouse.truncate"},
                {"input": {"database": "default", "target": "crypto_ticks"}},
                None,
            )
            self.assertIn("TRUNCATE TABLE", trunc)
            self.assertIn("crypto_ticks", trunc)

    def test_clickhouse_list_catalog_sql(self):
        with DomainSandbox("databases") as sb:
            rw = sb.import_runner()
            sql = rw._catalog_sql_for_list(
                "clickhouse.listTables", {"database": "default", "pattern": "crypto*"}
            )
            self.assertIn("system.tables", sql)
            self.assertIn("default", sql)

    def test_clickhouse_truncate_ignores_stale_select(self):
        with DomainSandbox("databases") as sb:
            rw = sb.import_runner()
            ctx = sb.base_ctx()
            executed = []

            def fake_execute(task, context, *, sql, connector):
                executed.append(sql)
                return [], True, None

            rw.execute_sql_structured = fake_execute
            task = make_task(
                id="ch_truncate",
                type="clickhouse.truncate",
                config={
                    "database": "agent_studio_test",
                    "target": "customers",
                    "sql": "SELECT * FROM agent_studio_test.customers",
                },
            )
            out = rw.handle_structured_db(task, ctx)
            self.assertEqual(
                executed, ["TRUNCATE TABLE IF EXISTS agent_studio_test.customers"]
            )
            self.assertEqual(out["result"]["op"], "clickhouse.truncate")
            self.assertTrue(out["result"]["live"])

    def test_clickhouse_insert_can_replace_test_data(self):
        with DomainSandbox("databases") as sb:
            sb.copy_data(DATA)
            sb.seed_stage_from_csv("stage.customers", "users.csv", limit=5)
            rw = sb.import_runner()
            ctx = sb.base_ctx()
            executed = []

            def fake_execute(task, context, *, sql, connector):
                executed.append(sql)
                return [], True, None

            rw.execute_sql_structured = fake_execute
            task = make_task(
                id="ch_insert_replace",
                type="clickhouse.insert",
                inputs=["stage.customers"],
                config={
                    "database": "agent_studio_test",
                    "target": "customers",
                    "truncateBeforeInsert": True,
                },
            )
            out = rw.handle_structured_db(task, ctx)
            self.assertEqual(
                executed[0],
                "TRUNCATE TABLE IF EXISTS agent_studio_test.customers",
            )
            self.assertTrue(executed[1].startswith("INSERT INTO agent_studio_test.customers"))
            self.assertEqual(
                out["result"]["query"]["preAction"],
                "TRUNCATE TABLE IF EXISTS agent_studio_test.customers",
            )

    def test_structured_pick_handlers(self):
        with DomainSandbox("databases") as sb:
            rw = sb.import_runner()
            for t in (
                "clickhouse.query",
                "clickhouse.createTable",
                "clickhouse.truncate",
                "mongodb.read",
                "postgresql.query",
                "mysql.query",
            ):
                h = rw.pick_handler(t)
                self.assertIsNot(h, rw.handle_default, msg=t)
                # mongodb.* is routed via structured_db (which delegates to handle_mongodb)
                if t.startswith("mongodb"):
                    self.assertIn(h, (rw.handle_mongodb, rw.handle_structured_db), msg=t)
                else:
                    self.assertEqual(h, rw.handle_structured_db)

    def test_special_de_ops_not_stubbed(self):
        with DomainSandbox("databases") as sb:
            rw = sb.import_runner()
            for t, expected in (
                ("mysql.cdc", rw.handle_structured_db),
                ("duckdb.import", rw.handle_structured_db),
                ("duckdb.export", rw.handle_structured_db),
                ("snowflake.load", rw.handle_structured_db),
                ("redshift.copy", rw.handle_structured_db),
                ("postgresql.copy", rw.handle_structured_db),
                ("cassandra.query", rw.handle_structured_db),
                ("trino.query", rw.handle_structured_db),
                ("trino.view", rw.handle_structured_db),
                ("trino.explain", rw.handle_structured_db),
                ("snowflake.merge", rw.handle_structured_db),
                ("postgresql.createSchema", rw.handle_structured_db),
                ("redis.get", rw.handle_de_plugin),
                ("kafka.produce", rw.handle_de_plugin),
                ("elasticsearch.search", rw.handle_de_plugin),
                ("neo4j.cypher", rw.handle_de_plugin),
                ("bigquery.query", rw.handle_de_plugin),
                ("airbyte.triggerSync", rw.handle_de_plugin),
                ("file.source", rw.handle_file),
                ("rest", rw.handle_rest),
                ("transform", rw.handle_transform),
            ):
                h = rw.pick_handler(t)
                self.assertIsNot(h, rw.handle_default, msg=t)
                self.assertEqual(h, expected, msg=t)
            self.assertTrue(callable(rw.handle_mysql_cdc))
            self.assertTrue(callable(rw.handle_duckdb_file))
            self.assertTrue(callable(rw.handle_warehouse_copy))
            self.assertTrue(callable(rw._snowflake_connection))
            self.assertTrue(callable(rw._cassandra_session))

    def test_duckdb_import_csv(self):
        with DomainSandbox("databases") as sb:
            try:
                import duckdb  # noqa: F401
            except ImportError:
                self.skipTest("duckdb not installed")
            rw = sb.import_runner()
            csv_path = sb.root / "sample.csv"
            csv_path.write_text("email,n\\na@b.com,1\\n", encoding="utf-8")
            ctx = sb.base_ctx()
            task = make_task(
                id="ddb_imp",
                type="duckdb.import",
                outputs=["stage.duck"],
                config={"path": str(csv_path), "target": "imported", "format": "csv"},
            )
            out = rw.handle_duckdb_file(task, ctx)
            result = out.get("result") or out
            self.assertTrue(result.get("ok") or result.get("live"))
            self.assertGreaterEqual(int(result.get("rowCount") or 0), 1)

    def test_seed_csv_usable_as_insert_rows(self):
        with DomainSandbox("databases") as sb:
            sb.copy_data(DATA)
            rows = sb.seed_stage_from_csv("stage.crypto", "crypto_ticks.csv")
            self.assertEqual(len(rows), 5)
            rw = sb.import_runner()
            ctx = sb.base_ctx()
            # insert SQL builder (no live execute required for resolve)
            task = make_task(
                id="ch_ins",
                type="clickhouse.insert",
                inputs=["stage.crypto"],
                config={"target": "crypto_ticks", "database": "default"},
            )
            sql = rw._resolve_clickhouse_sql(task, task["config"], None)
            self.assertIn("INSERT INTO", sql)
            self.assertIn("JSONEachRow", sql)

    @unittest.skipUnless(LIVE, "Set AS_LIVE_DB=1 to hit real ClickHouse/Mongo")
    def test_live_clickhouse_query(self):
        with DomainSandbox("databases") as sb:
            rw = sb.import_runner()
            ctx = sb.base_ctx(
                connectors=[
                    {
                        "id": "ch_local",
                        "type": "clickhouse",
                        "secret_ref": "secret://ch",
                        "config": {"host": "127.0.0.1", "port": 8123, "database": "default"},
                    }
                ]
            )
            sb.write_secrets({"secret://ch": '{"username":"default","password":"changeme"}'})
            ctx["secrets"] = {"secret://ch": '{"username":"default","password":"changeme"}'}
            task = make_task(
                id="ch_q",
                type="clickhouse.query",
                connector="ch_local",
                outputs=["stage.ch"],
                config={"sql": "SELECT 1 AS ok", "outputFormat": "yaml"},
            )
            out = rw.handle_structured_db(task, ctx)
            self.assertTrue(out["result"].get("live") or out["result"].get("rowCount", 0) >= 1)

    def test_pipeline_output_handover_to_downstream_rows(self):
        """Airflow-style envelopes become n8n items + Flowise json, then SQL insert can read them."""
        with DomainSandbox("databases") as sb:
            rw = sb.import_runner()
            payload = {
                "ok": True,
                "op": "airflow.listDags",
                "count": 2,
                "dags": [
                    {"dag_id": "etl_daily", "is_paused": False},
                    {"dag_id": "ml_train", "is_paused": True},
                ],
            }
            rows = rw._extract_item_rows(payload)
            self.assertEqual([r["dag_id"] for r in rows], ["etl_daily", "ml_train"])

            n8n_rows = rw._extract_item_rows(
                {"items": [{"json": {"email": "a@b.com"}}, {"json": {"email": "b@c.com"}}]}
            )
            self.assertEqual([r["email"] for r in n8n_rows], ["a@b.com", "b@c.com"])

            es_rows = rw._extract_item_rows(
                {
                    "hits": {
                        "hits": [
                            {"_id": "1", "_index": "docs", "_source": {"title": "alpha"}},
                            {"_id": "2", "_source": {"title": "beta"}},
                        ]
                    }
                }
            )
            self.assertEqual([r["title"] for r in es_rows], ["alpha", "beta"])

            wrapped = rw._as_item_payload(
                payload, {"op": "airflow.listDags", "ok": True, "live": True}
            )
            self.assertEqual(wrapped["items"][0]["json"]["dag_id"], "etl_daily")
            self.assertEqual(wrapped["json"]["dag_id"], "etl_daily")
            self.assertTrue(wrapped["handover"])

            task = make_task(
                id="af_list",
                type="airflow.listDags",
                outputs=["stage.dags"],
            )
            out = rw.emit_task_outputs(task, wrapped)
            result = out["result"]
            self.assertEqual(result["kind"], "tabular")
            self.assertEqual(result["rowCount"], 2)
            self.assertEqual(result["items"][1]["json"]["dag_id"], "ml_train")
            self.assertEqual(result["json"]["dag_id"], "etl_daily")
            self.assertTrue(result.get("text") or result.get("summary"))

            loaded = rw.load_stage("stage.af_list")
            downstream = rw.rows_from_dataset(loaded)
            self.assertEqual(len(downstream), 2)
            self.assertEqual(downstream[0]["dag_id"], "etl_daily")

            insert_task = make_task(
                id="pg_ins",
                type="postgresql.insert",
                inputs=["stage.af_list"],
                config={"target": "dags", "database": "public"},
            )
            got = rw._rows_from_task_inputs(insert_task)
            self.assertEqual(len(got), 2)
            self.assertEqual(got[1]["dag_id"], "ml_train")


if __name__ == "__main__":
    unittest.main()
