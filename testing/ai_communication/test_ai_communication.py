"""
AI + communication domain — handler wiring, stage handoff for RAG-like inputs,
log / notify registration.

LLM/agent live calls are not invoked (would need API keys); we assert routing
and that upstream stages load correctly.

  python3 -m unittest testing.ai_communication.test_ai_communication -v
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from testing.common.harness import DomainSandbox, make_task  # noqa: E402

DATA = Path(__file__).resolve().parent / "data"


class TestAiCommunicationNodes(unittest.TestCase):
    def test_ai_handlers_exist(self):
        with DomainSandbox("ai") as sb:
            rw = sb.import_runner()
            for t in ("llm", "agent"):
                self.assertIsNot(rw.pick_handler(t), rw.handle_default, msg=t)

    def test_docs_stage_for_rag_style_input(self):
        with DomainSandbox("ai") as sb:
            sb.copy_data(DATA)
            rows = sb.seed_stage_from_csv("stage.docs", "docs.csv")
            self.assertEqual(len(rows), 4)
            rw = sb.import_runner()
            ctx = sb.base_ctx()
            task = make_task(
                id="pass_docs",
                type="stage.pass",
                inputs=["stage.docs"],
                outputs=["stage.rag_context"],
                config={"outputFormat": "yaml"},
            )
            out = rw.handle_stage_load(task, ctx)
            self.assertEqual(out["result"]["rowCount"], 4)

    def test_communication_log(self):
        with DomainSandbox("ai") as sb:
            rw = sb.import_runner()
            ctx = sb.base_ctx()
            task = make_task(
                id="log_ai",
                type="log",
                config={"event": "ai_pipeline_start"},
            )
            self.assertTrue(rw.handle_log(task, ctx)["result"]["logged"])

    def test_notify_types_not_stub_only_if_registered(self):
        """notify.* may still be stub — document current wiring."""
        with DomainSandbox("ai") as sb:
            rw = sb.import_runner()
            # At minimum log is real; notify may map to default until implemented
            self.assertIsNot(rw.pick_handler("log"), rw.handle_default)

    def test_rag_subworkflow_and_agent_file(self):
        with DomainSandbox("ai") as sb:
            sb.copy_data(DATA)
            sb.seed_stage_from_csv("stage.docs", "docs.csv")
            rw = sb.import_runner()
            ctx = sb.base_ctx()
            self.assertIs(rw.pick_handler("rag"), rw.handle_rag)
            self.assertIs(rw.pick_handler("sub_workflow"), rw.handle_sub_workflow)
            self.assertIs(rw.pick_handler("agent"), rw.handle_agent)

            rag = make_task(
                id="rag_1",
                type="rag",
                inputs=["stage.docs"],
                outputs=["stage.rag"],
                config={"queryTemplate": "workflow stages", "topK": 2},
            )
            rag_out = rw.handle_rag(rag, ctx)
            self.assertEqual(rag_out["result"]["op"], "rag")
            self.assertGreaterEqual(rag_out["result"]["hitCount"], 1)

            sub = make_task(
                id="sub_1",
                type="sub_workflow",
                inputs=["stage.docs"],
                config={"waitForCompletion": True, "workspaceRef": "ws_child"},
            )
            sub_out = rw.handle_sub_workflow(sub, ctx)
            self.assertEqual(sub_out["result"]["status"], "success")
            self.assertTrue(sub_out["result"]["waitForCompletion"])
            self.assertGreater(sub_out["result"]["rowCounts"]["stage.docs"], 0)

            agents = sb.code / "agents"
            agents.mkdir(parents=True, exist_ok=True)
            (agents / "agent_1.py").write_text(
                "def run(stages, ctx):\n    return {'ok': True, 'from_file': True, 'n': len(stages)}\n",
                encoding="utf-8",
            )
            agent = make_task(
                id="agent_1",
                type="agent",
                inputs=["stage.docs"],
                config={"agentVendor": "langgraph", "executionMode": "local"},
            )
            agent_out = rw.handle_agent(agent, ctx)
            payload = agent_out.get("result") or agent_out
            inner = payload.get("output") if isinstance(payload.get("output"), dict) else payload
            self.assertTrue(inner.get("from_file") or payload.get("output", {}).get("from_file"))
            self.assertNotEqual(payload.get("status"), "local_stub")

    def test_agent_live_http_and_missing_key(self):
        with DomainSandbox("ai") as sb:
            rw = sb.import_runner()
            ctx = sb.base_ctx()

            def fake_http(url, method="GET", headers=None, body=None, timeout=60):
                return {"choices": [{"message": {"content": "hello-from-sdk"}}]}

            rw.http_json = fake_http
            live = make_task(
                id="agent_live",
                type="agent",
                config={
                    "agentVendor": "openai_assistants",
                    "provider": "openai",
                    "model": "gpt-4o-mini",
                    "executionMode": "local",
                    "secretRef": "secret://llm",
                    "enableDynamicCode": False,
                },
            )
            ctx["secrets"]["secret://llm"] = "sk-test"
            ctx["secrets"]["llm"] = "sk-test"
            out = rw.handle_agent(live, ctx)
            payload = out.get("result") or out
            content = (payload.get("output") or {}).get("content")
            self.assertEqual(content, "hello-from-sdk")
            live_status = str(payload.get("status") or payload.get("output") or "")
            self.assertTrue(
                any(token in live_status for token in ("vendor_sdk", "react_loop", "vendor_sdk_http")),
                live_status,
            )

            missing = make_task(
                id="agent_missing",
                type="agent",
                config={
                    "agentVendor": "langgraph",
                    "provider": "openai",
                    "executionMode": "local",
                    "enableDynamicCode": False,
                },
            )
            ctx2 = sb.base_ctx()
            import os
            from unittest.mock import patch

            with patch.dict(
                os.environ,
                {"OPENAI_API_KEY": "", "ANTHROPIC_API_KEY": "", "GROQ_API_KEY": ""},
                clear=False,
            ):
                with self.assertRaises(RuntimeError) as raised:
                    rw.handle_agent(missing, ctx2)
            self.assertIn("API key", str(raised.exception))
            self.assertNotIn("local_stub", str(raised.exception))

    def test_llm_gpt5_omits_temperature_and_openrouter_caps_tokens(self):
        with DomainSandbox("ai") as sb:
            rw = sb.import_runner()
            captured: dict = {}

            def fake_http(url, method="GET", headers=None, body=None, timeout=60):
                captured["url"] = url
                captured["body"] = dict(body or {})
                if "generateContent" in str(url):
                    return {
                        "candidates": [
                            {"content": {"parts": [{"text": "gemini-ok"}]}}
                        ]
                    }
                return {"choices": [{"message": {"content": "ok"}}]}

            rw.http_json = fake_http
            ctx = sb.base_ctx()
            ctx["secrets"]["secret://openai"] = "sk-test"
            gpt5 = make_task(
                id="llm_2",
                type="llm",
                config={
                    "provider": "openai",
                    "model": "gpt-5",
                    "temperature": 0.2,
                    "enableDynamicCode": False,
                    "secretRef": "secret://openai",
                    "userPrompt": "What is React?",
                },
            )
            out = rw.handle_llm(gpt5, ctx)
            self.assertNotIn("temperature", captured["body"])
            self.assertEqual((out["result"].get("summary") or out["result"].get("result", {}).get("summary")), "ok")

            captured.clear()
            ctx["secrets"]["secret://openrouter"] = "sk-or-test"
            router = make_task(
                id="llm_or",
                type="llm",
                config={
                    "provider": "openrouter",
                    "model": "openai/gpt-5",
                    "temperature": 0.2,
                    "maxTokens": 2048,
                    "enableDynamicCode": False,
                    "secretRef": "secret://openrouter",
                    "userPrompt": "What is React?",
                },
            )
            rw.handle_llm(router, ctx)
            self.assertEqual(captured["body"].get("max_tokens"), 2048)
            self.assertNotEqual(captured["body"].get("max_tokens"), 65536)
            self.assertNotIn("temperature", captured["body"])
            self.assertIn("openrouter.ai", captured["url"])

            captured.clear()
            default_or = make_task(
                id="llm_or_default",
                type="llm",
                config={
                    "provider": "openrouter",
                    "model": "openai/gpt-5",
                    "enableDynamicCode": False,
                    "secretRef": "secret://openrouter",
                },
            )
            rw.handle_llm(default_or, ctx)
            self.assertEqual(captured["body"].get("max_tokens"), 2048)

    def test_llm_google_generate_content_and_ollama_ignores_stale_gemini_url(self):
        with DomainSandbox("ai") as sb:
            rw = sb.import_runner()
            captured: dict = {}

            def fake_http(url, method="GET", headers=None, body=None, timeout=60):
                captured["url"] = url
                captured["body"] = dict(body or {})
                if "generateContent" in str(url):
                    return {
                        "candidates": [
                            {"content": {"parts": [{"text": "gemini-ok"}]}}
                        ]
                    }
                return {"choices": [{"message": {"content": "ollama-ok"}}]}

            rw.http_json = fake_http
            ctx = sb.base_ctx()
            ctx["secrets"]["secret://google_genai"] = "g-test"
            gem = make_task(
                id="llm_gemini",
                type="llm",
                config={
                    "provider": "google_genai",
                    "model": "gemini-2.5-pro",
                    "enableDynamicCode": False,
                    "secretRef": "secret://google_genai",
                    "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
                },
            )
            out = rw.handle_llm(gem, ctx)
            self.assertIn("generateContent", captured["url"])
            self.assertNotIn("/chat/completions", captured["url"])
            self.assertIn("gemini-2.5-pro", captured["url"])
            self.assertEqual(out["result"].get("summary") or out["result"].get("result", {}).get("summary"), "gemini-ok")

            captured.clear()
            ollama = make_task(
                id="llm_ollama",
                type="llm",
                config={
                    "provider": "ollama",
                    "model": "qwen2.5-coder",
                    "enableDynamicCode": False,
                    "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
                },
            )
            rw.handle_llm(ollama, ctx)
            self.assertIn("11434", captured["url"])
            self.assertIn("/chat/completions", captured["url"])
            self.assertNotIn("googleapis", captured["url"])

    def test_chat_trigger_and_memory_history_and_reply(self):
        with DomainSandbox("ai") as sb:
            rw = sb.import_runner()
            captured: dict = {}

            def fake_http(url, method="GET", headers=None, body=None, timeout=60):
                captured["url"] = url
                captured["body"] = dict(body or {})
                captured["messages"] = list((body or {}).get("messages") or [])
                return {"choices": [{"message": {"content": "React is a UI library."}}]}

            rw.http_json = fake_http
            ctx = sb.base_ctx()
            ctx["secrets"]["secret://openai"] = "sk-test"
            ctx["tasks"]["run"]["chat"] = {
                "sessionId": "chat_1",
                "question": "What is React?",
                "history": [
                    {"role": "user", "content": "Hi"},
                    {"role": "assistant", "content": "Hello!"},
                ],
            }
            start = make_task(
                id="start",
                type="trigger.chat",
                outputs=["stage.start"],
                config={"systemHint": "Be brief.", "outputFormat": "json"},
            )
            trig = rw.handle_trigger(start, ctx)
            self.assertEqual(trig["result"]["query"], "What is React?")
            rows = rw.rows_from_dataset(trig["result"])
            self.assertEqual(rows[0]["question"], "What is React?")

            llm = make_task(
                id="llm_1",
                type="llm",
                inputs=["stage.start"],
                outputs=["stage.llm_1"],
                config={
                    "provider": "openai",
                    "model": "gpt-4o-mini",
                    "enableDynamicCode": False,
                    "secretRef": "secret://openai",
                    "userPrompt": "{{query}}",
                    "memoryType": "window",
                    "memoryWindow": 10,
                    "systemPrompt": "You are helpful.",
                },
            )
            out = rw.handle_llm(llm, ctx)
            roles = [m.get("role") for m in captured["messages"]]
            self.assertIn("system", roles)
            self.assertEqual(captured["messages"][-1]["content"], "What is React?")
            self.assertIn("Hi", [m.get("content") for m in captured["messages"]])
            self.assertTrue(out["result"].get("summary") or (out["result"].get("result") or {}).get("summary"))

            reply = make_task(
                id="reply",
                type="chat.reply",
                inputs=["stage.llm_1"],
                outputs=["stage.reply"],
                config={"replyField": "summary"},
            )
            spoken = rw.handle_chat_reply(reply, ctx)
            self.assertEqual(spoken["result"]["op"], "chat.reply")
            self.assertIn("React", spoken["result"]["reply"])


if __name__ == "__main__":
    unittest.main()
