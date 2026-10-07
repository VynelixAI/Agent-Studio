"""
Control / workflow domain — if, switch, loop, parallel, wait, return,
human_approval, error_handler.

  python3 -m unittest testing.control_workflow.test_control -v
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from testing.common.harness import DomainSandbox, make_task  # noqa: E402

DATA = Path(__file__).resolve().parent / "data"


class TestControlWorkflowNodes(unittest.TestCase):
    def test_if_true_and_false_branches(self):
        with DomainSandbox("control") as sb:
            sb.copy_data(DATA)
            sb.seed_stage_from_csv("stage.items", "items.csv")
            rw = sb.import_runner()
            ctx = sb.base_ctx()
            ctx["tasks"]["edges"] = [
                {"id": "e1", "source": "if_1", "target": "then_node", "sourceHandle": "true"},
                {"id": "e2", "source": "if_1", "target": "else_node", "sourceHandle": "false"},
            ]
            task = make_task(
                id="if_1",
                type="if",
                inputs=["stage.items"],
                config={"condition": "row_count > 0", "trueLabel": "true", "falseLabel": "false"},
            )
            out = rw.handle_if(task, ctx)
            self.assertTrue(out["result"]["matched"])
            self.assertIn("else_node", ctx["skip_ids"])

            ctx2 = sb.base_ctx()
            ctx2["tasks"]["edges"] = ctx["tasks"]["edges"]
            task_f = make_task(
                id="if_1",
                type="if",
                inputs=["stage.items"],
                config={"condition": "row_count > 1000"},
            )
            out_f = rw.handle_if(task_f, ctx2)
            self.assertFalse(out_f["result"]["matched"])
            self.assertIn("then_node", ctx2["skip_ids"])

    def test_if_nested_config_and_default_condition(self):
        with DomainSandbox("control") as sb:
            sb.copy_data(DATA)
            sb.seed_stage_from_csv("stage.items", "items.csv")
            rw = sb.import_runner()
            ctx = sb.base_ctx()
            nested = make_task(
                id="if_nested",
                type="if",
                inputs=["stage.items"],
                config={"processing": {"condition": "row_count > 0"}},
            )
            out = rw.handle_if(nested, ctx)
            self.assertEqual(out["result"]["condition"], "row_count > 0")
            self.assertTrue(out["result"]["matched"])

            empty = make_task(
                id="if_default",
                type="if",
                inputs=["stage.items"],
                config={},
            )
            out_d = rw.handle_if(empty, ctx)
            self.assertEqual(out_d["result"]["condition"], "row_count > 0")
            self.assertTrue(out_d["result"]["matched"])
            self.assertTrue(out_d["result"]["conditionDefaulted"])

    def test_if_handover_passes_upstream_rows_to_next_node(self):
        """Oracle/CrewAI contract: IF stores output and downstream Code sees the same rows."""
        with DomainSandbox("control") as sb:
            sb.copy_data(DATA)
            sb.seed_stage_from_csv("stage.items", "items.csv")
            rw = sb.import_runner()
            ctx = sb.base_ctx()
            iff = make_task(
                id="if_handover",
                type="if",
                inputs=["stage.items"],
                outputs=["stage.if_handover"],
                config={"condition": "row_count > 0"},
            )
            if_out = rw.handle_if(iff, ctx)
            self.assertEqual(if_out["result"]["op"], "if")
            self.assertTrue(if_out["result"]["matched"])
            self.assertGreaterEqual(if_out["result"].get("rowCount", 0), 8)
            self.assertTrue(if_out["result"].get("handover"))
            loaded = rw.load_stage("stage.if_handover")
            self.assertGreaterEqual(len(rw.rows_from_dataset(loaded)), 8)

            code = make_task(
                id="code_after_if",
                type="code",
                inputs=["stage.if_handover"],
                outputs=["stage.code_after_if"],
            )
            code_out = rw.handle_code(code, ctx)
            self.assertGreaterEqual(code_out["result"].get("rowCount", 0), 8)

    def test_if_exposes_manual_run_payload_fields(self):
        with DomainSandbox("control") as sb:
            rw = sb.import_runner()
            ctx = sb.base_ctx()
            rw.save_stage(
                "stage.trigger",
                {
                    "kind": "tabular",
                    "op": "trigger",
                    "rows": [{"number": 10, "question": "What is React?"}],
                    "rowCount": 1,
                },
            )
            task = make_task(
                id="if_number",
                type="if",
                inputs=["stage.trigger"],
                outputs=["stage.if_number"],
                config={"condition": "number % 2 == 0"},
            )
            out = rw.handle_if(task, ctx)
            self.assertTrue(out["result"]["matched"])
            self.assertEqual(out["result"]["condition"], "number % 2 == 0")

            odd = make_task(
                id="if_odd",
                type="if",
                inputs=["stage.trigger"],
                config={"condition": "number % 2 == 1"},
            )
            out_odd = rw.handle_if(odd, ctx)
            self.assertFalse(out_odd["result"]["matched"])

    def test_if_llm_condition_agent(self):
        with DomainSandbox("control") as sb:
            rw = sb.import_runner()
            ctx = sb.base_ctx()
            ctx["secrets"]["secret://openai"] = "sk-test"
            rw.save_stage(
                "stage.chat",
                {
                    "kind": "tabular",
                    "op": "trigger",
                    "rows": [{"query": "How do I reset my password?"}],
                    "rowCount": 1,
                },
            )

            def fake_http(url, method="GET", headers=None, body=None, timeout=60):
                return {"choices": [{"message": {"content": "true"}}]}

            rw.http_json = fake_http
            task = make_task(
                id="if_llm",
                type="if",
                inputs=["stage.chat"],
                config={
                    "evaluator": "llm",
                    "condition": "the user is asking for account help",
                    "provider": "openai",
                    "model": "gpt-4o-mini",
                    "secretRef": "secret://openai",
                },
            )
            out = rw.handle_if(task, ctx)
            self.assertTrue(out["result"]["matched"])
            self.assertEqual(out["result"]["evaluator"], "llm")

    def test_loop_infers_items_from_inputs(self):
        with DomainSandbox("control") as sb:
            sb.copy_data(DATA)
            sb.seed_stage_from_csv("stage.items", "items.csv")
            rw = sb.import_runner()
            ctx = sb.base_ctx()
            task = make_task(
                id="loop_infer",
                type="loop",
                inputs=["stage.items"],
                outputs=["stage.loop_infer"],
                config={"outputFormat": "json"},
            )
            out = rw.handle_loop(task, ctx)
            self.assertEqual(out["result"]["count"], 8)
            self.assertTrue(out["result"]["rows"])

    def test_switch_matches_case(self):
        with DomainSandbox("control") as sb:
            sb.copy_data(DATA)
            # seed single-row stage for field lookup
            rows = sb.seed_stage_from_csv("stage.items", "items.csv", limit=1)
            rw = sb.import_runner()
            ctx = sb.base_ctx()
            task = make_task(
                id="sw_1",
                type="switch",
                inputs=["stage.items"],
                config={
                    # Field resolves against the first input row (not dotted stage path).
                    "field": "score_band",
                    "cases": ["high", "medium", "low"],
                    "defaultCase": "default",
                },
            )
            out = rw.handle_switch(task, ctx)
            self.assertEqual(out["result"]["branch"], rows[0]["score_band"])

    def test_loop_materializes_items(self):
        with DomainSandbox("control") as sb:
            sb.copy_data(DATA)
            sb.seed_stage_from_csv("stage.items", "items.csv")
            rw = sb.import_runner()
            ctx = sb.base_ctx()
            task = make_task(
                id="loop_1",
                type="loop",
                inputs=["stage.items"],
                outputs=["stage.loop"],
                config={"itemsPath": "stage.items", "mode": "sequential", "outputFormat": "yaml"},
            )
            out = rw.handle_loop(task, ctx)
            self.assertEqual(out["result"]["count"], 8)
            self.assertEqual(out["result"]["op"], "loop")

    def test_if_can_access_loop_items_and_alias(self):
        with DomainSandbox("control") as sb:
            sb.copy_data(DATA)
            sb.seed_stage_from_csv("stage.items", "items.csv")
            rw = sb.import_runner()
            ctx = sb.base_ctx()
            loop = make_task(
                id="loop_customers",
                type="loop",
                inputs=["stage.items"],
                outputs=["stage.loop_customers"],
                config={
                    "itemsPath": "stage.items",
                    "itemAlias": "customer",
                    "mode": "sequential",
                },
            )
            rw.handle_loop(loop, ctx)

            first_item = make_task(
                id="if_first",
                type="if",
                inputs=["stage.loop_customers"],
                config={"condition": "customer.item_id == 'I-1'"},
            )
            out = rw.handle_if(first_item, ctx)
            self.assertTrue(out["result"]["matched"])

            any_item = make_task(
                id="if_any",
                type="if",
                inputs=["stage.loop_customers"],
                config={
                    "condition": "any(row.score_band == 'high' for row in items)"
                },
            )
            out_any = rw.handle_if(any_item, ctx)
            self.assertTrue(out_any["result"]["matched"])

            stages = rw._load_control_stages(any_item)
            rows_map = rw._stage_rows_map(stages)
            self.assertIn(
                "high",
                rw._resolve_path("stage.loop_customers.score_band", stages, rows_map),
            )

    def test_parallel_fan_in(self):
        with DomainSandbox("control") as sb:
            sb.copy_data(DATA)
            sb.seed_stage_from_csv("stage.a", "items.csv", limit=3)
            sb.seed_stage_from_csv("stage.b", "items.csv", limit=2)
            rw = sb.import_runner()
            ctx = sb.base_ctx()
            task = make_task(
                id="par_1",
                type="parallel",
                inputs=["stage.a", "stage.b"],
                outputs=["stage.parallel"],
                config={"joinStrategy": "all", "outputFormat": "yaml"},
            )
            out = rw.handle_parallel(task, ctx)
            self.assertEqual(out["result"]["branchCount"], 2)
            self.assertEqual(out["result"]["rowCount"], 5)

    def test_wait_duration_fast(self):
        with DomainSandbox("control") as sb:
            rw = sb.import_runner()
            ctx = sb.base_ctx()
            task = make_task(
                id="wait_1",
                type="wait",
                config={"mode": "duration", "durationSec": 0, "maxWaitSec": 1},
            )
            out = rw.handle_wait(task, ctx)
            self.assertEqual(out["result"]["op"], "wait")
            self.assertEqual(out["result"]["waitedSec"], 0)

    def test_human_approval_auto(self):
        with DomainSandbox("control") as sb:
            sb.copy_data(DATA)
            sb.seed_stage_from_csv("stage.items", "items.csv", limit=2)
            rw = sb.import_runner()
            ctx = sb.base_ctx()
            task = make_task(
                id="apr_1",
                type="human_approval",
                inputs=["stage.items"],
                config={"message": "Approve {{ stage.items | length }} rows?", "requireManual": False},
            )
            out = rw.handle_human_approval(task, ctx)
            self.assertTrue(out["result"]["approved"])
            self.assertEqual(out["result"]["decision"], "auto_approved")

    def test_return_halts(self):
        with DomainSandbox("control") as sb:
            sb.copy_data(DATA)
            sb.seed_stage_from_csv("stage.items", "items.csv", limit=1)
            rw = sb.import_runner()
            ctx = sb.base_ctx()
            task = make_task(
                id="ret_1",
                type="return",
                inputs=["stage.items"],
                outputs=["stage.return"],
                config={"status": "success", "summaryTemplate": "done"},
            )
            out = rw.handle_return(task, ctx)
            self.assertTrue(ctx.get("halt"))
            self.assertEqual(out["result"]["status"], "success")

    def test_error_handler_registers(self):
        with DomainSandbox("control") as sb:
            rw = sb.import_runner()
            ctx = sb.base_ctx()
            task = make_task(
                id="eh_1",
                type="error_handler",
                config={"action": "retry", "maxAttempts": 2, "backoffMs": 1},
            )
            out = rw.handle_error_handler(task, ctx)
            self.assertEqual(len(ctx["error_handlers"]), 1)
            self.assertEqual(out["result"]["action"], "retry")

    def test_all_control_handlers_wired(self):
        with DomainSandbox("control") as sb:
            rw = sb.import_runner()
            expected = {
                "if": rw.handle_if,
                "switch": rw.handle_switch,
                "loop": rw.handle_loop,
                "parallel": rw.handle_parallel,
                "human_approval": rw.handle_human_approval,
                "wait": rw.handle_wait,
                "return": rw.handle_return,
                "error_handler": rw.handle_error_handler,
            }
            for t, handler in expected.items():
                picked = rw.pick_handler(t)
                self.assertIs(picked, handler, msg=f"{t} should route to dedicated handler")
                self.assertIsNot(picked, rw.handle_default, msg=t)

    def test_pick_handler_never_returns_stub_payload(self):
        """Full run-path smoke: pick_handler(type)(task) must not emit stub notes."""
        with DomainSandbox("control") as sb:
            sb.copy_data(DATA)
            sb.seed_stage_from_csv("stage.items", "items.csv", limit=2)
            rw = sb.import_runner()
            fixtures = [
                (
                    "if",
                    {
                        "condition": "10 > 5",
                        "trueLabel": "true",
                        "falseLabel": "false",
                    },
                    "if",
                ),
                (
                    "switch",
                    {"field": "score_band", "cases": ["high", "medium", "low"]},
                    "switch",
                ),
                (
                    "loop",
                    {"itemsPath": "stage.items", "outputFormat": "json"},
                    "loop",
                ),
                (
                    "parallel",
                    {"joinStrategy": "all", "outputFormat": "json"},
                    "parallel",
                ),
                (
                    "human_approval",
                    {"message": "ok?", "requireManual": False},
                    "human_approval",
                ),
                (
                    "wait",
                    {"mode": "duration", "durationSec": 0},
                    "wait",
                ),
                (
                    "return",
                    {"status": "success", "summaryTemplate": "done"},
                    "return",
                ),
                (
                    "error_handler",
                    {"action": "retry", "maxAttempts": 1, "backoffMs": 0},
                    "error_handler",
                ),
            ]
            for type_name, config, expected_op in fixtures:
                with self.subTest(type=type_name):
                    ctx = sb.base_ctx()
                    task = make_task(
                        id=f"{type_name}_smoke",
                        type=type_name,
                        inputs=["stage.items"],
                        outputs=[f"stage.{type_name}_smoke"],
                        config=config,
                    )
                    handler = rw.pick_handler(type_name)
                    self.assertIsNot(handler, rw.handle_default)
                    out = handler(task, ctx)
                    result = out["result"]
                    note = str(result.get("note") or "")
                    self.assertNotIn("No dedicated handler yet", note)
                    self.assertNotIn("hit the stub handler", note)
                    # Dedicated handlers set op (or action for error_handler / status for return)
                    if expected_op == "error_handler":
                        self.assertEqual(result.get("op"), "error_handler")
                    elif expected_op == "return":
                        self.assertEqual(result.get("op"), "return")
                    else:
                        self.assertEqual(result.get("op"), expected_op)


if __name__ == "__main__":
    unittest.main()
