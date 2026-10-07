"""
Automation domain — Prefect routing, wait/notify/log, webhook stubs.

  python3 -m unittest testing.automation.test_automation -v
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from testing.common.harness import DomainSandbox, make_task  # noqa: E402

DATA = Path(__file__).resolve().parent / "data"


class TestAutomationNodes(unittest.TestCase):
    @staticmethod
    def airflow_connector():
        return {
            "id": "airflow_test",
            "type": "airflow",
            "secret_ref": "secret://airflow-test",
            "config": {
                "baseUrl": "http://airflow.test/api/v1",
                "username": "airflow",
                "dagId": "etl_daily",
            },
        }

    def test_prefect_handler_wired(self):
        with DomainSandbox("automation") as sb:
            rw = sb.import_runner()
            for t in (
                "prefect.listDeployments",
                "prefect.triggerDeployment",
                "prefect.runStatus",
                "prefect.cancelRun",
                "prefect.setVariable",
                "prefect.readVariable",
                "prefect.workPoolStatus",
            ):
                self.assertEqual(rw.pick_handler(t), rw.handle_prefect, msg=t)

    def test_prefect_requires_connector(self):
        with DomainSandbox("automation") as sb:
            rw = sb.import_runner()
            ctx = sb.base_ctx()
            task = make_task(
                id="pf_1",
                type="prefect.listDeployments",
                config={"limit": 10},
            )
            with self.assertRaises(RuntimeError) as cm:
                rw.handle_prefect(task, ctx)
            self.assertIn("connector", str(cm.exception).lower())

    def test_airflow_handlers_wired(self):
        with DomainSandbox("automation") as sb:
            rw = sb.import_runner()
            for t in (
                "airflow.triggerDag",
                "airflow.dagStatus",
                "airflow.xcomPull",
                "airflow.xcomPush",
                "airflow.listDags",
                "airflow.pauseDag",
                "airflow.clearTask",
                "airflow.importVariables",
            ):
                self.assertIs(rw.pick_handler(t), rw.handle_airflow, msg=t)
                self.assertIsNot(rw.pick_handler(t), rw.handle_default, msg=t)

    def test_airflow_four_reported_nodes_do_not_stub(self):
        with DomainSandbox("automation") as sb:
            rw = sb.import_runner()
            ctx = sb.base_ctx(connectors=[self.airflow_connector()])
            ctx["secrets"] = {
                "secret://airflow-test": '{"username":"airflow","password":"airflow"}'
            }
            calls = []

            def fake_http(url, method="GET", headers=None, body=None, timeout=60):
                calls.append((url, method, headers, body))
                if "/xcomEntries/return_value" in url:
                    return {"key": "return_value", "value": {"rows": 3}}
                if url.endswith("/xcomEntries"):
                    return {"accepted": True}
                if "/variables/" in url:
                    return {"key": "environment", "value": body.get("value")}
                if "/dags?" in url:
                    return {
                        "dags": [{"dag_id": "etl_daily", "is_paused": False}],
                        "total_entries": 1,
                    }
                return {"ok": True}

            rw.http_json = fake_http
            fixtures = [
                (
                    "airflow.xcomPull",
                    {
                        "dagRunId": "manual__1",
                        "taskId": "transform",
                        "xcomKey": "return_value",
                    },
                ),
                (
                    "airflow.xcomPush",
                    {
                        "dagRunId": "manual__1",
                        "taskId": "transform",
                        "xcomKey": "result",
                        "value": {"ready": True},
                    },
                ),
                ("airflow.listDags", {"limit": 25, "onlyActive": True}),
                (
                    "airflow.importVariables",
                    {"variableName": "environment", "value": "test"},
                ),
            ]
            for type_name, config in fixtures:
                with self.subTest(type=type_name):
                    task = make_task(
                        id=type_name.replace(".", "_"),
                        type=type_name,
                        connector="airflow_test",
                        config=config,
                    )
                    result = rw.pick_handler(type_name)(task, ctx)["result"]
                    self.assertEqual(result["op"], type_name)
                    self.assertNotIn(
                        "No dedicated handler yet", str(result.get("note") or "")
                    )

            # listDags → one n8n item per DAG ($json.dag_id)
            list_task = make_task(
                id="af_list",
                type="airflow.listDags",
                connector="airflow_test",
                outputs=["stage.dags"],
                config={"limit": 25},
            )
            listed = rw.handle_airflow(list_task, ctx)["result"]
            self.assertEqual(listed["rowCount"], 1)
            self.assertEqual(listed["json"]["dag_id"], "etl_daily")
            self.assertEqual(listed["items"][0]["json"]["dag_id"], "etl_daily")

            # triggerDag flattens dag_run_id for dagStatus bind (n8n $json)
            def fake_trigger(url, method="GET", headers=None, body=None, timeout=60):
                return {
                    "dag_id": "etl_daily",
                    "dag_run_id": "manual__99",
                    "state": "queued",
                }

            rw.http_json = fake_trigger
            trig = rw.handle_airflow(
                make_task(
                    id="af_trig",
                    type="airflow.triggerDag",
                    connector="airflow_test",
                    config={"dagId": "etl_daily"},
                ),
                ctx,
            )["result"]
            self.assertEqual(trig["json"]["dag_id"], "etl_daily")
            self.assertEqual(trig["json"]["dagId"], "etl_daily")
            self.assertEqual(trig["json"]["dag_run_id"], "manual__99")
            self.assertEqual(trig["json"]["dagRunId"], "manual__99")
            self.assertEqual(trig["json"]["state"], "queued")

            # dagStatus binds dag_run_id from trigger $json (n8n paired items)
            status_calls = []

            def fake_status(url, method="GET", headers=None, body=None, timeout=60):
                status_calls.append((url, method))
                return {
                    "dag_id": "etl_daily",
                    "dag_run_id": "manual__99",
                    "state": "success",
                }

            rw.http_json = fake_status
            rw.save_stage(
                "stage.af_trig",
                {"json": trig["json"], "items": trig["items"], "rows": [trig["json"]]},
            )
            st = rw.handle_airflow(
                make_task(
                    id="af_status",
                    type="airflow.dagStatus",
                    connector="airflow_test",
                    inputs=["stage.af_trig"],
                    config={},  # bind from upstream $json
                ),
                ctx,
            )["result"]
            self.assertEqual(st["json"]["dag_run_id"], "manual__99")
            self.assertEqual(st["json"]["dagRunId"], "manual__99")
            self.assertEqual(st["json"]["state"], "success")
            self.assertTrue(any("dagRuns/manual__99" in u for u, _ in status_calls))

            # 4 fixtures + 1 explicit listDags item-contract check (trigger uses a separate stub)
            self.assertEqual(len(calls), 5)
            auth_headers = [call[2] for call in calls]
            self.assertTrue(
                all(str(h.get("Authorization", "")).startswith("Basic ") for h in auth_headers)
            )

    def test_wait_and_log(self):
        with DomainSandbox("automation") as sb:
            rw = sb.import_runner()
            ctx = sb.base_ctx()
            wait = make_task(
                id="w1",
                type="wait",
                config={"mode": "duration", "durationSec": 0},
            )
            self.assertEqual(rw.handle_wait(wait, ctx)["result"]["op"], "wait")
            log = make_task(id="l1", type="log", config={"event": "automation_tick"})
            self.assertTrue(rw.handle_log(log, ctx)["result"]["logged"])

    def test_deployments_csv_seed(self):
        with DomainSandbox("automation") as sb:
            sb.copy_data(DATA)
            rows = sb.seed_stage_from_csv("stage.deployments", "deployments.csv")
            self.assertEqual(len(rows), 3)
            ready = [r for r in rows if r.get("status") == "READY"]
            self.assertEqual(len(ready), 2)

    def test_filter_deployments_helper(self):
        with DomainSandbox("automation") as sb:
            sb.copy_data(DATA)
            rows = sb.seed_stage_from_csv("stage.deployments", "deployments.csv")
            rw = sb.import_runner()
            deps = [{"id": str(i), "name": r["deployment_name"]} for i, r in enumerate(rows)]
            matched = rw.filter_deployments_by_name(deps, "daily-etl", "exact")
            self.assertEqual(len(matched), 1)
            matched2 = rw.filter_deployments_by_name(deps, "etl", "contains")
            self.assertGreaterEqual(len(matched2), 1)

    def test_pipeline_families_not_stubbed(self):
        with DomainSandbox("automation") as sb:
            rw = sb.import_runner()
            for t, expected in (
                ("airflow.triggerDag", rw.handle_airflow),
                ("prefect.triggerDeployment", rw.handle_prefect),
                ("spark.submit", rw.handle_spark),
                ("dagster.launchRun", rw.handle_de_plugin),
                ("dbt.run", rw.handle_de_plugin),
                ("flink.jobStatus", rw.handle_de_plugin),
                ("airbyte.triggerSync", rw.handle_de_plugin),
                ("nifi.startProcessGroup", rw.handle_de_plugin),
                ("temporal.startWorkflow", rw.handle_de_plugin),
                ("great_expectations.checkpoint", rw.handle_de_plugin),
                ("databricks.notebook", rw.handle_de_plugin),
            ):
                h = rw.pick_handler(t)
                self.assertIsNot(h, rw.handle_default, msg=t)
                self.assertEqual(h, expected, msg=t)
            src = Path(rw.__file__).read_text(encoding="utf-8")
            self.assertIn("workspaceOrError", src)
            self.assertIn("temporalio is required", src)
            self.assertIn("Unsupported Prefect node type", src)
            self.assertNotIn("fallback_sample", src)


if __name__ == "__main__":
    unittest.main()
