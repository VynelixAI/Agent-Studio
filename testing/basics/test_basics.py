"""
Basics domain — stage load/pass, transform, code/python, file, log, triggers.

  cd <repo>
  npx tsx testing/scripts/emit_codegen.ts
  python3 -m unittest testing.basics.test_basics -v
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from testing.common.harness import DomainSandbox, make_task  # noqa: E402

DATA = Path(__file__).resolve().parent / "data"


class TestBasicsNodes(unittest.TestCase):
    def test_stage_load_and_pass(self):
        with DomainSandbox("basics") as sb:
            sb.copy_data(DATA)
            sb.seed_stage_from_csv("stage.orders", "orders.csv")
            rw = sb.import_runner()
            ctx = sb.base_ctx()
            task = make_task(
                id="stage_pass_1",
                type="stage.pass",
                inputs=["stage.orders"],
                outputs=["stage.passed"],
                config={"outputFormat": "yaml"},
            )
            result = rw.handle_stage_load(task, ctx)
            self.assertIn("outputFiles", result)
            payload = result["result"]
            self.assertEqual(payload.get("kind"), "tabular")
            self.assertGreaterEqual(payload.get("rowCount", 0), 5)

    def test_transform_merges_upstream_rows(self):
        with DomainSandbox("basics") as sb:
            sb.copy_data(DATA)
            sb.seed_stage_from_csv("stage.orders", "orders.csv")
            sb.seed_stage_from_csv("stage.customers", "customers.csv")
            rw = sb.import_runner()
            ctx = sb.base_ctx()
            task = make_task(
                id="transform_1",
                type="transform",
                inputs=["stage.orders", "stage.customers"],
                outputs=["stage.merged"],
                config={"outputFormat": "json"},
            )
            result = rw.handle_transform(task, ctx)
            payload = result["result"]
            self.assertEqual(payload.get("kind"), "tabular")
            # orders(8) + customers(5)
            self.assertEqual(payload.get("rowCount"), 13)

    def test_code_node_filters_shipped(self):
        with DomainSandbox("basics") as sb:
            sb.copy_data(DATA)
            sb.seed_stage_from_csv("stage.orders", "orders.csv")
            rw = sb.import_runner()
            ctx = sb.base_ctx()
            script = (
                "def run(stages, ctx):\n"
                "    from stage_dataset import rows_from_dataset\n"
                "    rows = rows_from_dataset(stages.get('stage.orders') or {})\n"
                "    shipped = [r for r in rows if r.get('status') == 'shipped']\n"
                "    return {'ok': True, 'shipped': len(shipped), 'rows': shipped}\n"
            )
            task = make_task(
                id="code_1",
                type="code",
                inputs=["stage.orders"],
                outputs=["stage.shipped"],
                config={"script": script, "outputFormat": "json"},
            )
            result = rw.handle_code(task, ctx)
            payload = result["result"]
            self.assertTrue(payload.get("ok"))
            self.assertEqual(payload.get("shipped"), 4)

    def test_python_alias(self):
        with DomainSandbox("basics") as sb:
            rw = sb.import_runner()
            self.assertIs(rw.pick_handler("python"), rw.handle_python)

    def test_file_and_log_and_trigger(self):
        with DomainSandbox("basics") as sb:
            sb.copy_data(DATA)
            rw = sb.import_runner()
            ctx = sb.base_ctx()
            file_task = make_task(
                id="file_1",
                type="file.source",
                outputs=["stage.file"],
                config={"path": str(sb.data / "orders.csv"), "outputFormat": "json"},
            )
            out = rw.handle_file(file_task, ctx)
            self.assertIn("orders.csv", str(out["result"].get("path")))

            log_task = make_task(
                id="log_1",
                type="log",
                config={"event": "basics_ok"},
            )
            log_out = rw.handle_log(log_task, ctx)
            self.assertTrue(log_out["result"].get("logged"))

            trig = make_task(
                id="trig_1",
                type="trigger.manual",
                outputs=["stage.trigger"],
            )
            t_out = rw.handle_trigger(trig, ctx)
            self.assertTrue(t_out["result"].get("triggered"))
            self.assertGreaterEqual(t_out["result"].get("rowCount", 0), 1)

            loop = make_task(
                id="loop_from_trigger",
                type="loop",
                inputs=["stage.trigger"],
                outputs=["stage.loop"],
                config={"outputFormat": "json"},
            )
            loop_out = rw.handle_loop(loop, ctx)
            self.assertEqual(loop_out["result"]["count"], 1)
            self.assertTrue(loop_out["result"]["rows"][0].get("triggered"))

            empty_code = make_task(
                id="code_passthrough",
                type="code",
                inputs=["stage.trigger"],
                outputs=["stage.code"],
            )
            code_out = rw.handle_code(empty_code, ctx)
            self.assertGreaterEqual(code_out["result"].get("rowCount", 0), 1)
            self.assertIn("passed through", str(code_out["result"].get("note") or ""))

            vars_task = make_task(
                id="vars_1",
                type="set_variables",
                config={"variables": {"env": "test", "batch_id": "{{ run.id }}"}},
            )
            vars_out = rw.handle_set_variables(vars_task, ctx)
            self.assertEqual(vars_out["result"]["op"], "set_variables")
            self.assertEqual(vars_out["result"]["variables"].get("env"), "test")
            self.assertEqual(vars_out["result"]["variables"].get("batch_id"), "run_basics")

            # Unique stage keys: function node output is stored even when outputs omitted
            auto_code = make_task(
                id="fn_unique",
                type="code",
                inputs=["stage.trigger"],
            )
            auto_code["outputs"] = []
            auto_out = rw.handle_code(auto_code, ctx)
            self.assertGreaterEqual(auto_out["result"].get("rowCount", 0), 1)
            self.assertIsNotNone(rw.load_stage("stage.fn_unique"))

    def test_handlers_registered(self):
        with DomainSandbox("basics") as sb:
            rw = sb.import_runner()
            for t in (
                "stage.load",
                "stage.pass",
                "transform",
                "code",
                "python",
                "file.source",
                "log",
                "trigger.manual",
                "set_variables",
                "notebook",
            ):
                self.assertIsNot(rw.pick_handler(t), rw.handle_default, msg=t)


if __name__ == "__main__":
    unittest.main()
