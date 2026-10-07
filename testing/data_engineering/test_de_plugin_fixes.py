"""
Regression tests for reported Airflow / Kafka / Flink / dbt / NiFi / GX node errors.

External libraries (kafka-python, great_expectations) are faked so the tests
exercise the Studio handler logic without a live cluster.

  python3 -m unittest testing.data_engineering.test_de_plugin_fixes -v
"""
from __future__ import annotations

import json
import ssl
import sys
import types
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from testing.common.harness import DomainSandbox, make_task  # noqa: E402


def _conn(cid: str, ctype: str, config: dict) -> dict:
    return {"id": cid, "type": ctype, "config": config}


class _Recorder:
    def __init__(self, responder=None):
        self.calls: list[dict] = []
        self.responder = responder or (lambda url, method, body: {"ok": True})

    def __call__(self, url, method="GET", headers=None, body=None, timeout=60, ssl_context=None):
        self.calls.append(
            {"url": url, "method": method, "body": body, "ssl_context": ssl_context,
             "headers": dict(headers or {})}
        )
        return self.responder(url, method, body)


class TestAirflowRequestBodies(unittest.TestCase):
    def _ctx(self, sb):
        ctx = sb.base_ctx(
            connectors=[
                {
                    "id": "af",
                    "type": "airflow",
                    "secret_ref": "secret://af",
                    "config": {"baseUrl": "http://airflow.test/api/v1", "username": "a"},
                }
            ]
        )
        ctx["secrets"] = {"secret://af": '{"username":"a","password":"b"}'}
        return ctx

    def test_set_variable_sends_key_on_patch_and_create(self):
        with DomainSandbox("de_fix_af") as sb:
            rw = sb.import_runner()

            def responder(url, method, body):
                if method == "PATCH":
                    raise RuntimeError(f"HTTP 404 {url}: not found")
                return {"key": body["key"], "value": body["value"]}

            rec = _Recorder(responder)
            rw.http_json = rec
            out = rw.handle_airflow(
                make_task(
                    id="af_var",
                    type="airflow.importVariables",
                    connector="af",
                    config={"variableName": "env", "value": "prod"},
                ),
                self._ctx(sb),
            )["result"]
            patch, post = rec.calls
            self.assertEqual(patch["body"], {"key": "env", "value": "prod"})
            self.assertEqual(post["body"], {"key": "env", "value": "prod"})
            self.assertTrue(post["url"].endswith("/variables"))
            self.assertEqual(out["json"]["action"], "created")

    def test_trigger_dag_passes_logical_date(self):
        with DomainSandbox("de_fix_af2") as sb:
            rw = sb.import_runner()
            rec = _Recorder(lambda u, m, b: {"dag_id": "etl", "dag_run_id": "r1", "state": "queued"})
            rw.http_json = rec
            rw.handle_airflow(
                make_task(
                    id="af_trig",
                    type="airflow.triggerDag",
                    connector="af",
                    config={"dagId": "etl", "logicalDate": "2026-09-01T00:00:00Z"},
                ),
                self._ctx(sb),
            )
            self.assertEqual(rec.calls[0]["body"]["logical_date"], "2026-09-01T00:00:00Z")


class TestAirflowVersions(unittest.TestCase):
    def _ctx(self, sb, config):
        ctx = sb.base_ctx(
            connectors=[{"id": "af", "type": "airflow", "secret_ref": "secret://af", "config": config}]
        )
        ctx["secrets"] = {"secret://af": '{"username":"a","password":"b"}'}
        return ctx

    def _run(self, sb, rw, type_name, config, conn_config, responder, inputs=None):
        rec = _Recorder(responder)
        rw.http_json = rec
        out = rw.handle_airflow(
            make_task(id=type_name.replace(".", "_"), type=type_name, connector="af",
                      config=config, inputs=inputs or []),
            self._ctx(sb, conn_config),
        )["result"]
        return rec, out

    def test_airflow3_detected_uses_api_v2_jwt_and_null_logical_date(self):
        with DomainSandbox("de_af_v3") as sb:
            rw = sb.import_runner()

            def responder(url, method, body):
                if url.endswith("/api/v2/version"):
                    return {"version": "3.0.2"}
                if url.endswith("/auth/token"):
                    return {"access_token": "jwt3"}
                return {"dag_id": "etl", "dag_run_id": "manual__1", "state": "queued"}

            rec, out = self._run(sb, rw, "airflow.triggerDag", {"dagId": "etl"},
                                 {"baseUrl": "http://af3.test"}, responder)
            trigger = rec.calls[-1]
            self.assertEqual(trigger["url"], "http://af3.test/api/v2/dags/etl/dagRuns")
            self.assertIn("logical_date", trigger["body"])
            self.assertIsNone(trigger["body"]["logical_date"])
            self.assertEqual(trigger["headers"]["Authorization"], "Bearer jwt3")
            self.assertEqual(out["json"]["dag_run_id"], "manual__1")

    def test_airflow3_list_dags_uses_exclude_stale(self):
        with DomainSandbox("de_af_v3b") as sb:
            rw = sb.import_runner()
            rec, _ = self._run(
                sb, rw, "airflow.listDags", {"onlyActive": True},
                {"baseUrl": "http://af3.test", "apiVersion": "3", "token": "t"},
                lambda u, m, b: {"dags": [{"dag_id": "etl"}], "total_entries": 1},
            )
            self.assertIn("/api/v2/dags?", rec.calls[0]["url"])
            self.assertIn("exclude_stale=true", rec.calls[0]["url"])
            self.assertNotIn("only_active", rec.calls[0]["url"])

    def test_airflow21_detected_sends_execution_date_with_basic_auth(self):
        with DomainSandbox("de_af_v21") as sb:
            rw = sb.import_runner()

            def responder(url, method, body):
                if url.endswith("/api/v2/version"):
                    raise RuntimeError(f"HTTP 404 {url}: not found")
                if url.endswith("/api/v1/version"):
                    return {"version": "2.1.4"}
                return {"dag_id": "etl", "dag_run_id": "r1", "state": "queued"}

            rec, _ = self._run(sb, rw, "airflow.triggerDag",
                               {"dagId": "etl", "logicalDate": "2026-09-01T00:00:00Z"},
                               {"baseUrl": "http://af2.test"}, responder)
            trigger = rec.calls[-1]
            self.assertEqual(trigger["url"], "http://af2.test/api/v1/dags/etl/dagRuns")
            self.assertEqual(trigger["body"]["execution_date"], "2026-09-01T00:00:00Z")
            self.assertNotIn("logical_date", trigger["body"])
            self.assertTrue(trigger["headers"]["Authorization"].startswith("Basic "))

    def test_airflow110_experimental_trigger_status_pause(self):
        with DomainSandbox("de_af_v1") as sb:
            rw = sb.import_runner()
            conn = {"baseUrl": "http://af1.test", "apiVersion": "1"}
            rec, out = self._run(
                sb, rw, "airflow.triggerDag", {"dagId": "etl", "dagRunId": "manual_1"}, conn,
                lambda u, m, b: {"message": "Created", "execution_date": "2026-09-01T00:00:00+00:00",
                                 "run_id": "manual_1"},
            )
            self.assertEqual(rec.calls[0]["url"], "http://af1.test/api/experimental/dags/etl/dag_runs")
            self.assertEqual(rec.calls[0]["body"]["run_id"], "manual_1")
            self.assertEqual(out["json"]["execution_date"], "2026-09-01T00:00:00+00:00")

            rw.save_stage("stage.trig", {"rows": [out["json"]]})
            rec, st = self._run(sb, rw, "airflow.dagStatus", {}, conn,
                                lambda u, m, b: {"state": "running"}, inputs=["stage.trig"])
            self.assertEqual(
                rec.calls[0]["url"],
                "http://af1.test/api/experimental/dags/etl/dag_runs/2026-09-01T00%3A00%3A00%2B00%3A00",
            )
            self.assertEqual(st["json"]["state"], "running")

            rec, _ = self._run(sb, rw, "airflow.pauseDag", {"dagId": "etl", "isPaused": True}, conn,
                               lambda u, m, b: {"response": "ok"})
            self.assertEqual(rec.calls[0]["url"], "http://af1.test/api/experimental/dags/etl/paused/true")

            with self.assertRaises(RuntimeError) as cm:
                self._run(sb, rw, "airflow.xcomPull",
                          {"dagId": "etl", "dagRunId": "r", "taskId": "t", "xcomKey": "k"}, conn,
                          lambda u, m, b: {})
            self.assertIn("Airflow 1.10", str(cm.exception))

    def test_xcom_pull_parses_stringified_json(self):
        with DomainSandbox("de_af_xcom") as sb:
            rw = sb.import_runner()
            _, out = self._run(
                sb, rw, "airflow.xcomPull",
                {"dagId": "etl", "dagRunId": "r", "taskId": "t", "xcomKey": "k"},
                {"baseUrl": "http://af.test/api/v2", "token": "t"},
                lambda u, m, b: {"key": "k", "value": '{"rows": 3}'},
            )
            self.assertEqual(out["json"]["value"], {"rows": 3})


class TestFlinkEndpoints(unittest.TestCase):
    def _ctx(self, sb):
        return sb.base_ctx(
            connectors=[_conn("fl", "flink", {"restUrl": "http://flink.test:8081"})]
        )

    def _run(self, sb, rw, type_name, config, responder=None, inputs=None):
        rec = _Recorder(responder)
        rw.http_json = rec
        out = rw.handle_http_product(
            make_task(id=type_name.replace(".", "_"), type=type_name, connector="fl",
                      config=config, inputs=inputs or []),
            self._ctx(sb),
        )["result"]
        return rec, out

    def test_submit_uses_jar_id_from_job_id_field(self):
        with DomainSandbox("de_fix_fl1") as sb:
            rw = sb.import_runner()
            rec, out = self._run(
                sb, rw, "flink.submit", {"jobId": "abc_job.jar"},
                responder=lambda u, m, b: {"jobid": "j-1"},
            )
            self.assertEqual(rec.calls[0]["url"], "http://flink.test:8081/jars/abc_job.jar/run")
            self.assertEqual(out["json"]["jobId"], "j-1")

    def test_submit_without_jar_lists_available_ids(self):
        with DomainSandbox("de_fix_fl2") as sb:
            rw = sb.import_runner()
            with self.assertRaises(RuntimeError) as cm:
                self._run(sb, rw, "flink.submit", {},
                          responder=lambda u, m, b: {"files": [{"id": "x_job.jar"}]})
            self.assertIn("x_job.jar", str(cm.exception))

    def test_cancel_uses_mode_cancel_not_yarn_cancel(self):
        with DomainSandbox("de_fix_fl3") as sb:
            rw = sb.import_runner()
            rec, _ = self._run(sb, rw, "flink.cancel", {"resourceName": "d8d1"})
            self.assertEqual(len(rec.calls), 1)
            self.assertEqual(rec.calls[0]["url"], "http://flink.test:8081/jobs/d8d1?mode=cancel")
            self.assertEqual(rec.calls[0]["method"], "PATCH")

    def test_savepoint_and_rescale_take_job_id_from_resource_name(self):
        with DomainSandbox("de_fix_fl4") as sb:
            rw = sb.import_runner()
            rec, _ = self._run(sb, rw, "flink.savepoint", {"resourceName": "job42"})
            self.assertEqual(rec.calls[0]["url"], "http://flink.test:8081/jobs/job42/savepoints")
            rec, _ = self._run(sb, rw, "flink.rescale", {"resourceName": "job42", "parallelism": 3})
            self.assertEqual(
                rec.calls[0]["url"], "http://flink.test:8081/jobs/job42/rescaling?parallelism=3"
            )

    def test_job_id_binds_from_upstream_item(self):
        with DomainSandbox("de_fix_fl5") as sb:
            rw = sb.import_runner()
            rw.save_stage("stage.up", {"rows": [{"jid": "up-7", "state": "RUNNING"}]})
            rec, _ = self._run(sb, rw, "flink.savepoint", {}, inputs=["stage.up"])
            self.assertIn("/jobs/up-7/savepoints", rec.calls[0]["url"])

    def test_missing_job_id_is_a_clear_error_not_empty_path(self):
        with DomainSandbox("de_fix_fl6") as sb:
            rw = sb.import_runner()
            with self.assertRaises(RuntimeError) as cm:
                self._run(sb, rw, "flink.rescale", {"parallelism": 2})
            self.assertIn("requires a Job ID", str(cm.exception))


class TestDbtCoreJobStatus(unittest.TestCase):
    def test_job_status_reads_run_results_instead_of_cli(self):
        with DomainSandbox("de_fix_dbt") as sb:
            rw = sb.import_runner()
            project = sb.root / "dbt_proj"
            (project / "target").mkdir(parents=True)
            (project / "target" / "run_results.json").write_text(
                json.dumps(
                    {
                        "metadata": {"invocation_id": "inv-1", "generated_at": "now"},
                        "elapsed_time": 1.5,
                        "results": [
                            {"unique_id": "model.a", "status": "success", "execution_time": 0.4},
                            {"unique_id": "test.b", "status": "fail", "failures": 2},
                        ],
                    }
                ),
                encoding="utf-8",
            )
            ctx = sb.base_ctx(connectors=[_conn("dbt", "dbt", {"mode": "core"})])
            out = rw.handle_http_product(
                make_task(id="dbt_st", type="dbt.jobStatus", connector="dbt",
                          config={"projectDir": str(project)}),
                ctx,
            )["result"]
            self.assertEqual(out["rowCount"], 2)
            self.assertEqual(out["status"], "error")
            self.assertEqual(out["failed"], 1)
            self.assertEqual(out["items"][0]["json"]["unique_id"], "model.a")


class TestNiFiTls(unittest.TestCase):
    def test_localhost_https_allows_self_signed(self):
        with DomainSandbox("de_fix_nifi1") as sb:
            rw = sb.import_runner()
            ctx = rw._tls_context({}, "https://localhost:8443/nifi-api")
            self.assertEqual(ctx.verify_mode, ssl.CERT_NONE)
            remote = rw._tls_context({}, "https://nifi.example.com/nifi-api")
            self.assertEqual(remote.verify_mode, ssl.CERT_REQUIRED)
            opt_in = rw._tls_context({"verifySsl": "false"}, "https://nifi.example.com/nifi-api")
            self.assertEqual(opt_in.verify_mode, ssl.CERT_NONE)
            self.assertIsNone(rw._tls_context({}, "http://localhost:8080/nifi-api"))

    def test_nifi_nodes_pass_ssl_context_to_http(self):
        with DomainSandbox("de_fix_nifi2") as sb:
            rw = sb.import_runner()
            ctx = sb.base_ctx(
                connectors=[_conn("nf", "nifi", {"baseUrl": "https://127.0.0.1:8443/nifi-api",
                                                 "token": "jwt", "verifySsl": "false"})]
            )

            def responder(url, method, body):
                if url.endswith("/variable-registry") and method == "GET":
                    return {"processGroupRevision": {"version": 4}}
                if url.endswith("/status"):
                    return {"processGroupStatus": {"aggregateSnapshot": {"name": "root", "queuedCount": "3"}}}
                return {"processGroups": [{"id": "pg1", "component": {"name": "Ingest"}}]}

            for type_name, config in (
                ("nifi.listProcessGroups", {}),
                ("nifi.queueStatus", {}),
                ("nifi.provenance", {}),
                ("nifi.updateVariable", {"parameters": {"env": "prod"}}),
            ):
                with self.subTest(type=type_name):
                    rec = _Recorder(responder)
                    rw.http_json = rec
                    rw.handle_http_product(
                        make_task(id=type_name.replace(".", "_"), type=type_name,
                                  connector="nf", config=config),
                        ctx,
                    )
                    for call in rec.calls:
                        self.assertIsNotNone(call["ssl_context"], call["url"])
                        self.assertEqual(call["ssl_context"].verify_mode, ssl.CERT_NONE)
                    if type_name == "nifi.updateVariable":
                        put = rec.calls[-1]["body"]
                        self.assertEqual(put["processGroupRevision"], {"version": 4})
                        self.assertEqual(
                            put["variableRegistry"]["variables"][0]["variable"],
                            {"name": "env", "value": "prod"},
                        )


class TestNiFiVersions(unittest.TestCase):
    def _run(self, sb, rw, type_name, config, conn_config, responder):
        rec = _Recorder(responder)
        rw.http_json = rec
        real_sleep = rw.time.sleep
        rw.time.sleep = lambda _s: None
        try:
            out = rw.handle_http_product(
                make_task(id=type_name.replace(".", "_"), type=type_name, connector="nf", config=config),
                sb.base_ctx(connectors=[_conn("nf", "nifi", {"baseUrl": "http://nifi.test:8080/nifi-api",
                                                             **conn_config})]),
            )["result"]
        finally:
            rw.time.sleep = real_sleep
        return rec, out

    def test_nifi2_update_variable_uses_parameter_context(self):
        with DomainSandbox("de_nifi_v2") as sb:
            rw = sb.import_runner()

            def responder(url, method, body):
                if url.endswith("/process-groups/root"):
                    return {"id": "root-id", "revision": {"version": 1},
                            "component": {"id": "root-id", "name": "root",
                                          "parameterContext": {"id": "pc1"}}}
                if url.endswith("/parameter-contexts/pc1") and method == "GET":
                    return {"revision": {"version": 3}}
                if url.endswith("/update-requests") and method == "POST":
                    return {"request": {"requestId": "r1", "complete": False}}
                if url.endswith("/update-requests/r1") and method == "GET":
                    return {"request": {"requestId": "r1", "complete": True}}
                return {}

            rec, out = self._run(sb, rw, "nifi.updateVariable", {"parameters": {"env": "prod"}},
                                 {"nifiVersion": "2"}, responder)
            self.assertFalse(any("variable-registry" in c["url"] for c in rec.calls))
            post = next(c for c in rec.calls if c["url"].endswith("/update-requests"))
            self.assertEqual(post["body"]["revision"], {"version": 3})
            self.assertEqual(post["body"]["component"]["parameters"][0]["parameter"]["name"], "env")
            self.assertTrue(any(c["method"] == "DELETE" for c in rec.calls))
            self.assertEqual(out["json"]["parameterContextId"], "pc1")

    def test_auto_falls_back_to_parameters_and_creates_context(self):
        with DomainSandbox("de_nifi_auto") as sb:
            rw = sb.import_runner()

            def responder(url, method, body):
                if url.endswith("/variable-registry"):
                    raise RuntimeError(f"HTTP 404 {url}: not found")
                if url.endswith("/process-groups/root"):
                    return {"id": "root-id", "revision": {"version": 2},
                            "component": {"id": "root-id", "name": "root"}}
                if url.endswith("/parameter-contexts") and method == "POST":
                    return {"id": "pc-new"}
                return {}

            rec, out = self._run(sb, rw, "nifi.updateVariable", {"parameters": {"env": "prod"}}, {},
                                 responder)
            bind = next(c for c in rec.calls if c["method"] == "PUT")
            self.assertTrue(bind["url"].endswith("/process-groups/root-id"))
            self.assertEqual(bind["body"]["component"]["parameterContext"], {"id": "pc-new"})
            self.assertEqual(bind["body"]["revision"], {"version": 2})
            self.assertTrue(out["json"]["created"])

    def test_provenance_polls_until_finished_and_flattens_events(self):
        with DomainSandbox("de_nifi_prov") as sb:
            rw = sb.import_runner()

            def responder(url, method, body):
                if method == "POST":
                    return {"provenance": {"id": "p1", "finished": False}}
                if method == "GET":
                    return {"provenance": {"id": "p1", "finished": True, "results": {
                        "provenanceEvents": [{"eventId": 7, "eventType": "RECEIVE", "componentName": "GetFile"}]}}}
                return {}

            rec, out = self._run(sb, rw, "nifi.provenance", {}, {}, responder)
            self.assertEqual(out["json"]["eventId"], 7)
            self.assertEqual(out["json"]["eventType"], "RECEIVE")
            self.assertEqual(rec.calls[-1]["method"], "DELETE")


class TestDbtVersions(unittest.TestCase):
    def test_select_flag_matches_dbt_version(self):
        with DomainSandbox("de_dbt_flags") as sb:
            rw = sb.import_runner()
            old = {"version": "0.20.2", "tuple": (0, 20, 2), "engine": "core"}
            new = {"version": "1.12.5", "tuple": (1, 12, 5), "engine": "core"}
            cfg = {"select": "tag:daily", "profileTarget": "prod", "fullRefresh": True}
            self.assertEqual(
                rw._dbt_core_command("dbt", "run", cfg, old),
                ["dbt", "run", "--models", "tag:daily", "--target", "prod", "--full-refresh"],
            )
            self.assertEqual(
                rw._dbt_core_command("dbt", "run", cfg, new),
                ["dbt", "run", "--select", "tag:daily", "--target", "prod", "--full-refresh"],
            )
            self.assertEqual(rw._dbt_core_command("dbt", "seed", {"select": "s"}, old)[2], "--select")
            with self.assertRaises(RuntimeError):
                rw._dbt_core_command("dbt", "build", {}, old)
            # user-supplied flags win and are not duplicated
            cmd = rw._dbt_core_command("dbt", "test", {"select": "a", "parameters": ["-s", "b"]}, new)
            self.assertEqual(cmd, ["dbt", "test", "-s", "b"])
            cmd = rw._dbt_core_command("dbt", "run", {"parameters": {"threads": 4, "fail-fast": True}}, new)
            self.assertEqual(cmd, ["dbt", "run", "--threads", "4", "--fail-fast"])

    def test_legacy_run_results_are_normalised(self):
        with DomainSandbox("de_dbt_legacy") as sb:
            rw = sb.import_runner()
            rows, summary = rw._dbt_results_rows({"results": [
                {"node": {"unique_id": "model.a"}, "status": "CREATE VIEW", "error": None, "fail": None},
                {"node": {"unique_id": "test.b"}, "status": None, "fail": True},
                {"node": {"unique_id": "model.c"}, "status": "ERROR", "error": "boom"},
            ]})
            self.assertEqual([r["unique_id"] for r in rows], ["model.a", "test.b", "model.c"])
            self.assertEqual([r["status"] for r in rows], ["success", "fail", "error"])
            self.assertEqual(summary["failed"], 2)

    def test_core_run_detects_version_and_reads_results(self):
        with DomainSandbox("de_dbt_core") as sb:
            rw = sb.import_runner()
            project = sb.root / "proj"
            project.mkdir()
            fake = sb.root / "fake_dbt"
            fake.write_text(
                "#!/usr/bin/env python3\n"
                "import json, sys, pathlib\n"
                "if sys.argv[1] == '--version':\n"
                "    print('Core:\\n  - installed: 1.12.5\\n  - latest: 1.12.5')\n"
                "    sys.exit(0)\n"
                "pathlib.Path('args.json').write_text(json.dumps(sys.argv[1:]))\n"
                "pathlib.Path('target').mkdir(exist_ok=True)\n"
                "pathlib.Path('target/run_results.json').write_text(json.dumps({'metadata': {'dbt_version': '1.12.5'},\n"
                "  'results': [{'unique_id': 'test.x', 'status': 'fail', 'failures': 1}]}))\n"
                "sys.exit(1)\n",
                encoding="utf-8",
            )
            fake.chmod(0o755)
            ctx = sb.base_ctx(connectors=[_conn("dbt", "dbt", {"mode": "core", "dbtPath": str(fake),
                                                                "target": "prod"})])
            out = rw.handle_http_product(
                make_task(id="dbt_t", type="dbt.test", connector="dbt",
                          config={"projectDir": str(project), "suite": "tag:nightly", "failOnError": False}),
                ctx,
            )["result"]
            args = json.loads((project / "args.json").read_text())
            self.assertEqual(args, ["test", "--select", "tag:nightly", "--target", "prod"])
            self.assertEqual(out["json"]["unique_id"], "test.x")
            self.assertEqual(out["dbt_version"], "1.12.5")
            self.assertEqual(out["exitCode"], 1)

            with self.assertRaises(RuntimeError) as cm:
                rw.handle_http_product(
                    make_task(id="dbt_t2", type="dbt.test", connector="dbt",
                              config={"projectDir": str(project)}),
                    ctx,
                )
            self.assertIn("dbt 1.12.5", str(cm.exception))

    def test_cloud_job_status_regional_host_token_and_upstream_run_id(self):
        with DomainSandbox("de_dbt_cloud") as sb:
            rw = sb.import_runner()
            rec = _Recorder(lambda u, m, b: {"data": {"id": 55, "status": 10, "is_complete": True}})
            rw.http_json = rec
            ctx = sb.base_ctx(connectors=[{
                "id": "dbt", "type": "dbt", "secret_ref": "secret://dbt",
                "config": {"mode": "cloud", "accountId": "1", "baseUrl": "emea.dbt.com"},
            }])
            ctx["secrets"] = {"secret://dbt": '{"apiToken":"abc"}'}
            rw.save_stage("stage.run", {"rows": [{"run_id": 55}]})
            out = rw.handle_http_product(
                make_task(id="dbt_st", type="dbt.jobStatus", connector="dbt", inputs=["stage.run"], config={}),
                ctx,
            )["result"]
            self.assertEqual(rec.calls[0]["url"], "https://emea.dbt.com/api/v2/accounts/1/runs/55/")
            self.assertEqual(rec.calls[0]["headers"]["Authorization"], "Token abc")
            self.assertEqual(out["json"]["status"], "success")


class _FakeTP:
    def __init__(self, topic, partition):
        self.topic, self.partition = topic, partition

    def __hash__(self):
        return hash((self.topic, self.partition))

    def __eq__(self, other):
        return (self.topic, self.partition) == (other.topic, other.partition)


def _install_fake_kafka(admin_cls):
    kafka = types.ModuleType("kafka")
    admin = types.ModuleType("kafka.admin")
    structs = types.ModuleType("kafka.structs")
    admin.KafkaAdminClient = admin_cls  # no RecordsToDelete, like kafka-python 3.x
    structs.TopicPartition = _FakeTP

    class _Consumer:
        def __init__(self, **_kw):
            pass

        def end_offsets(self, tps):
            return {tp: 10 for tp in tps}

        def close(self):
            pass

    kafka.KafkaConsumer = _Consumer
    kafka.admin, kafka.structs = admin, structs
    saved = {k: sys.modules.get(k) for k in ("kafka", "kafka.admin", "kafka.structs")}
    sys.modules.update({"kafka": kafka, "kafka.admin": admin, "kafka.structs": structs})
    return saved


def _restore(saved):
    for k, v in saved.items():
        if v is None:
            sys.modules.pop(k, None)
        else:
            sys.modules[k] = v


class TestKafkaCompat(unittest.TestCase):
    def test_delete_records_without_records_to_delete_class(self):
        seen = {}

        class Admin:
            def __init__(self, **_kw):
                pass

            def delete_records(self, mapping):
                seen.update(mapping)
                return {}

            def close(self):
                pass

        saved = _install_fake_kafka(Admin)
        try:
            with DomainSandbox("de_fix_kafka1") as sb:
                rw = sb.import_runner()
                ctx = sb.base_ctx(connectors=[_conn("kf", "kafka", {"bootstrapServers": "k:9092"})])
                rw.handle_kafka(
                    make_task(id="kf_del", type="kafka.deleteRecords", connector="kf",
                              config={"target": "events", "partition": 0, "offset": 5}),
                    ctx,
                )
            self.assertEqual(seen, {_FakeTP("events", 0): 5})
        finally:
            _restore(saved)

    def test_describe_consumer_falls_back_to_committed_offsets(self):
        class Admin:
            def __init__(self, **_kw):
                pass

            def list_consumer_group_offsets(self, group_id=None):
                return {_FakeTP("events", 0): types.SimpleNamespace(offset=7)}

            def close(self):
                pass

        saved = _install_fake_kafka(Admin)
        try:
            with DomainSandbox("de_fix_kafka2") as sb:
                rw = sb.import_runner()
                ctx = sb.base_ctx(connectors=[_conn("kf", "kafka", {"bootstrapServers": "k:9092"})])
                out = rw.handle_kafka(
                    make_task(id="kf_desc", type="kafka.describeConsumer", connector="kf",
                              config={"resourceName": "billing"}),
                    ctx,
                )["result"]
            row = out["json"]
            self.assertEqual(row["group"], "billing")
            self.assertEqual(row["committed_offset"], 7)
            self.assertEqual(row["lag"], 3)
        finally:
            _restore(saved)


def _install_fake_gx():
    gx = types.ModuleType("great_expectations")
    gx.__version__ = "1.5.0"
    store = {"suites": {}, "ran": []}

    class Suite:
        def __init__(self, name):
            self.name, self.expectations = name, []

        def add_expectation(self, exp):
            self.expectations.append(exp)

    class _Suites:
        def add(self, suite):
            store["suites"][suite.name] = suite
            return suite

        def delete(self, name):
            store["suites"].pop(name, None)

        def all(self):
            return list(store["suites"].values())

    class _Checkpoint:
        def __init__(self, name):
            self.name = name

        def run(self):
            store["ran"].append(self.name)
            return types.SimpleNamespace(
                to_json_dict=lambda: {"success": True, "statistics": {"evaluated_expectations": 2}}
            )

    class _Checkpoints:
        def get(self, name):
            return _Checkpoint(name)

        def all(self):
            return [_Checkpoint("daily_checkpoint")]

    context = types.SimpleNamespace(suites=_Suites(), checkpoints=_Checkpoints())
    gx.get_context = lambda **_kw: context
    gx.ExpectationSuite = Suite
    exps = types.ModuleType("great_expectations.expectations")
    exps.ExpectColumnToExist = lambda column: ("exist", column)
    exps.ExpectColumnValuesToNotBeNull = lambda column: ("not_null", column)
    gx.expectations = exps
    saved = {k: sys.modules.get(k) for k in ("great_expectations", "great_expectations.expectations")}
    sys.modules["great_expectations"] = gx
    sys.modules["great_expectations.expectations"] = exps
    return saved, store


class TestGreatExpectationsCompat(unittest.TestCase):
    def test_checkpoint_name_read_from_suite_field(self):
        saved, store = _install_fake_gx()
        try:
            with DomainSandbox("de_fix_gx1") as sb:
                rw = sb.import_runner()
                ctx = sb.base_ctx(connectors=[_conn("gx", "great_expectations", {})])
                out = rw.handle_http_product(
                    make_task(id="gx_cp", type="great_expectations.checkpoint", connector="gx",
                              config={"suite": "daily_checkpoint"}),
                    ctx,
                )["result"]
            self.assertEqual(store["ran"], ["daily_checkpoint"])
            self.assertTrue(out["json"]["success"])
        finally:
            _restore(saved)

    def test_create_suite_and_profile_on_gx_1x(self):
        saved, store = _install_fake_gx()
        try:
            with DomainSandbox("de_fix_gx2") as sb:
                rw = sb.import_runner()
                ctx = sb.base_ctx(connectors=[_conn("gx", "great_expectations", {})])
                rw.handle_http_product(
                    make_task(id="gx_new", type="great_expectations.createSuite", connector="gx",
                              config={"resourceName": "orders_suite"}),
                    ctx,
                )
                self.assertIn("orders_suite", store["suites"])

                rw.save_stage("stage.orders", {"rows": [{"id": 1, "note": None}, {"id": 2, "note": "x"}]})
                out = rw.handle_http_product(
                    make_task(id="gx_prof", type="great_expectations.profile", connector="gx",
                              inputs=["stage.orders"], config={"resourceName": "orders_profile"}),
                    ctx,
                )["result"]
            exps = store["suites"]["orders_profile"].expectations
            self.assertIn(("exist", "id"), exps)
            self.assertIn(("not_null", "id"), exps)
            self.assertNotIn(("not_null", "note"), exps)
            self.assertEqual(out["json"]["expectations"], 3)
        finally:
            _restore(saved)


class TestMultiVersionFallbacks(unittest.TestCase):
    """Database / orchestration version-compat helpers keep old configs working."""

    def test_pg_connect_normalises_uri_and_falls_back_to_psycopg3(self):
        seen: list = []
        fake_pg3 = types.ModuleType("psycopg")
        fake_pg3.connect = lambda uri=None, **kw: seen.append(uri or kw) or "conn3"
        saved = {k: sys.modules.get(k) for k in ("psycopg2", "psycopg")}
        sys.modules["psycopg2"] = None  # type: ignore[assignment]
        sys.modules["psycopg"] = fake_pg3
        try:
            with DomainSandbox("de_mv_pg") as sb:
                rw = sb.import_runner()
                self.assertEqual(rw._pg_connect("jdbc:postgresql+psycopg2://u:p@h:5432/db"), "conn3")
                rw._pg_connect("redshift://u:p@cluster:5439/dev")
                rw._pg_connect("postgres://u:p@h/db")
                rw._pg_connect(host="h", dbname="db")
            self.assertEqual(
                seen,
                [
                    "postgresql://u:p@h:5432/db",
                    "postgresql://u:p@cluster:5439/dev",
                    "postgresql://u:p@h/db",
                    {"host": "h", "dbname": "db"},
                ],
            )
        finally:
            _restore(saved)

    def test_mongo_host_uri_quotes_credentials_and_sets_direct_connection(self):
        with DomainSandbox("de_mv_mongo") as sb:
            rw = sb.import_runner()
            uri = rw._mongo_host_uri(
                {"host": "db.local", "port": 27017, "authSource": "admin"},
                {"username": "app@corp", "password": "p:ss/w%rd"},
                "shop",
            )
            self.assertEqual(
                uri,
                "mongodb://app%40corp:p%3Ass%2Fw%25rd@db.local:27017/shop"
                "?authSource=admin&directConnection=true",
            )
            rs = rw._mongo_host_uri({"host": "a:1,b:2", "replicaSet": "rs0"}, {}, "x")
            self.assertEqual(rs, "mongodb://a:1,b:2/x?replicaSet=rs0")

    def test_prefect_api_base_keeps_existing_urls(self):
        with DomainSandbox("de_mv_pf") as sb:
            rw = sb.import_runner()
            cloud = "https://api.prefect.cloud/api/accounts/a1/workspaces/w1"
            self.assertEqual(rw._prefect_api_base(cloud, {}, {}), cloud)
            self.assertEqual(
                rw._prefect_api_base("https://api.prefect.cloud", {"accountId": "a1", "workspaceId": "w1"}, {}),
                cloud,
            )
            self.assertEqual(rw._prefect_api_base("http://h:4200/api", {}, {}), "http://h:4200/api")
            self.assertEqual(rw._prefect_api_base("http://h:4200", {}, {}), "http://h:4200/api")

    def test_prefect_set_variable_patches_on_conflict_and_stringifies_for_2x(self):
        with DomainSandbox("de_mv_pf2") as sb:
            rw = sb.import_runner()

            def responder(url, method, body):
                if method == "POST" and not isinstance(body["value"], str):
                    raise RuntimeError(f"HTTP 422 {url}: value must be a string")
                if method == "POST":
                    raise RuntimeError(f"HTTP 409 {url}: already exists")
                return {"name": "cfg"}

            rec = _Recorder(responder)
            rw.http_json = rec
            ctx = sb.base_ctx(
                connectors=[{"id": "pf", "type": "prefect", "config": {"apiUrl": "http://prefect.test:4200"}}]
            )
            rw.handle_prefect(
                make_task(id="pf_var", type="prefect.setVariable", connector="pf",
                          config={"name": "my cfg", "value": {"a": 1}, "limit": 5000}),
                ctx,
            )
            methods = [c["method"] for c in rec.calls]
            self.assertEqual(methods, ["POST", "POST", "PATCH"])
            self.assertTrue(rec.calls[0]["url"].startswith("http://prefect.test:4200/api/variables"))
            self.assertEqual(rec.calls[1]["body"]["value"], '{"a": 1}')
            self.assertTrue(rec.calls[2]["url"].endswith("/variables/name/my%20cfg"))
            self.assertNotIn("Authorization", rec.calls[0]["headers"])

    def test_es_api_key_and_total_shapes(self):
        with DomainSandbox("de_mv_es") as sb:
            rw = sb.import_runner()
            h = rw._es_auth_headers({"apiKey": "id1:secret"}, {})
            self.assertEqual(h["Authorization"], "ApiKey aWQxOnNlY3JldA==")
            basic = rw._es_auth_headers({"username": "elastic", "password": "pw"}, {})
            self.assertTrue(basic["Authorization"].startswith("Basic "))
            self.assertEqual(rw._es_total({"hits": {"total": 7}}), 7)
            self.assertEqual(rw._es_total({"hits": {"total": {"value": 9, "relation": "eq"}}}), 9)

    def test_spark_status_falls_back_to_master_json(self):
        with DomainSandbox("de_mv_spark") as sb:
            rw = sb.import_runner()

            def responder(url, method, body):
                if url.endswith("/json/"):
                    return {"activeapps": [{"id": "app-9", "name": "etl", "state": "RUNNING"}]}
                raise RuntimeError(f"HTTP 404 {url}")

            rec = _Recorder(responder)
            rw.http_json = rec
            ctx = sb.base_ctx(
                connectors=[{"id": "spk", "type": "spark", "config": {"master": "spark://m.test:7077"}}]
            )
            st = rw.handle_spark(
                make_task(id="spk_st", type="spark.jobStatus", connector="spk", config={"appId": "app-9"}),
                ctx,
            )["result"]
            self.assertEqual(st["json"]["state"], "RUNNING")
            self.assertTrue(st["json"]["live"])
            self.assertTrue(any(c["url"] == "http://m.test:8080/json/" for c in rec.calls))


if __name__ == "__main__":
    unittest.main()
