"""Tests for the ContextKeep Agent Hooks interceptor.

stdlib unittest, no pytest dependency — this package ships with zero
dependencies and its tests should not quietly require one.
"""

import json
import os
import socket
import struct
import sys
import tempfile
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from contextkeep_hooks import ContextKeepInterceptor, decide, fail_closed, to_interception, to_verdict  # noqa: E402
from contextkeep_hooks.protocol import encode_frame, read_frame  # noqa: E402


class FakeDaemon:
    """A minimal daemon speaking our wire protocol."""

    def __init__(self, verdict, delay=0.0, garbage=False):
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, "d.sock")
        self.verdict = verdict
        self.delay = delay
        self.garbage = garbage
        self.received = []
        self._srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self._srv.bind(self.path)
        self._srv.listen(4)
        self._stop = False
        self._thread = threading.Thread(target=self._serve, daemon=True)
        self._thread.start()

    def _serve(self):
        while not self._stop:
            try:
                conn, _ = self._srv.accept()
            except OSError:
                return
            try:
                self.received.append(read_frame(conn))
                if self.delay:
                    threading.Event().wait(self.delay)
                conn.sendall(b"not-a-frame" if self.garbage else encode_frame(self.verdict))
            except Exception:
                pass
            finally:
                conn.close()

    def close(self):
        self._stop = True
        try:
            self._srv.close()
        except OSError:
            pass


ALLOW = {"protocolVersion": 1, "decision": "allow", "detections": []}


def ctx(point="pre_tool_call", **over):
    base = {
        "spec": "agent-hooks/0.1",
        "interception_point": point,
        "timestamp": "2026-09-14T12:00:00Z",
        "sequence": 1,
        "agent": {"id": "a1", "framework": "langgraph"},
        "session": {"id": "s1"},
        "target": {"call_id": "c1", "name": "Edit", "args": {"file_path": "/repo/prod.ts"}},
    }
    base.update(over)
    return base


class TestContextTranslation(unittest.TestCase):
    def test_maps_every_interception_point(self):
        expected = {
            "agent_startup": "agent_start",
            "input": "input",
            "pre_model_call": "pre_model",
            "post_model_call": "post_model",
            "pre_tool_call": "pre_tool",
            "post_tool_call": "post_tool",
            "output": "output",
            "agent_shutdown": "agent_end",
        }
        for hook_point, ours in expected.items():
            self.assertEqual(to_interception(ctx(hook_point))["point"], ours)

    def test_carries_framework_so_reports_can_attribute(self):
        self.assertEqual(to_interception(ctx())["framework"], "langgraph")

    def test_extracts_the_tool_call(self):
        call = to_interception(ctx())["toolCall"]
        self.assertEqual(call["name"], "Edit")
        self.assertEqual(call["id"], "c1")
        self.assertEqual(call["input"], {"file_path": "/repo/prod.ts"})

    def test_no_tool_call_outside_tool_points(self):
        self.assertNotIn("toolCall", to_interception(ctx("input")))

    def test_survives_a_malformed_timestamp(self):
        self.assertIsInstance(to_interception(ctx(timestamp="not a date"))["ts"], int)

    def test_survives_a_context_missing_optional_fields(self):
        i = to_interception({"interception_point": "input", "session": {}, "agent": {}})
        self.assertEqual(i["sessionId"], "unknown")


class TestVerdictCollapse(unittest.TestCase):
    """Our five decisions become the spec's three (§5.1)."""

    def test_allow(self):
        self.assertEqual(to_verdict({"decision": "allow"}, "pre_tool_call"), {"decision": "allow"})

    def test_warn_becomes_allow_with_a_warning(self):
        v = to_verdict({"decision": "warn", "reason": "r", "message": "m"}, "pre_tool_call")
        self.assertEqual(v["decision"], "allow")
        self.assertEqual(v["warnings"], [{"reason": "r", "message": "m"}])

    def test_deny_stays_deny(self):
        self.assertEqual(to_verdict({"decision": "deny", "reason": "r"}, "pre_tool_call")["decision"], "deny")

    def test_escalate_becomes_a_liftable_deny(self):
        v = to_verdict({"decision": "escalate", "reason": "r"}, "pre_tool_call")
        self.assertEqual(v["decision"], "deny")
        self.assertIn("approval", v)

    def test_transform_carries_the_repair_payload(self):
        v = to_verdict({"decision": "transform", "transform": {"restore": ["never edit prod"]}}, "pre_tool_call")
        self.assertEqual(v["decision"], "transform")
        self.assertEqual(v["transform"]["value"], ["never edit prod"])

    def test_transform_degrades_to_a_warning_where_it_is_forbidden(self):
        # §3, §4.3: transform is not permitted at the lifecycle endpoints.
        # Emitting it anyway would be an invalid verdict and fail the host
        # closed; dropping it silently would hide a real finding.
        for point in ("agent_startup", "agent_shutdown"):
            v = to_verdict({"decision": "transform", "transform": {"restore": ["x"]}}, point)
            self.assertEqual(v["decision"], "allow")
            self.assertEqual(v["warnings"][0]["reason"], "transform_not_permitted")


class TestClientFailsClosed(unittest.TestCase):
    def test_unreachable_daemon_denies(self):
        v = decide({"point": "pre_tool"}, socket_path="/tmp/contextkeep-does-not-exist.sock")
        self.assertEqual(v["decision"], "deny")
        self.assertEqual(v["reason"], "unreachable")

    def test_timeout_denies(self):
        d = FakeDaemon(ALLOW, delay=1.0)
        try:
            v = decide({"point": "pre_tool"}, socket_path=d.path, timeout_s=0.15)
            self.assertEqual(v["decision"], "deny")
            self.assertEqual(v["reason"], "timeout")
        finally:
            d.close()

    def test_malformed_verdict_denies(self):
        d = FakeDaemon(ALLOW, garbage=True)
        try:
            v = decide({"point": "pre_tool"}, socket_path=d.path, timeout_s=1.0)
            self.assertEqual(v["decision"], "deny")
        finally:
            d.close()

    def test_fail_closed_shape(self):
        v = fail_closed("timeout")
        self.assertEqual(v["decision"], "deny")
        self.assertEqual(v["reason"], "timeout")


class TestInterceptorNeverRaises(unittest.TestCase):
    """A host treats an interceptor exception as a fail-closed deny, so an
    unhandled error of ours would block a user's agent."""

    def test_allows_and_warns_when_the_daemon_is_down(self):
        i = ContextKeepInterceptor(socket_path="/tmp/contextkeep-does-not-exist.sock", timeout_s=0.2)
        v = i.intercept(ctx())
        self.assertEqual(v["decision"], "deny")  # fail-closed from the client
        self.assertEqual(v["reason"], "unreachable")

    def test_end_to_end_against_a_daemon(self):
        d = FakeDaemon({"protocolVersion": 1, "decision": "deny", "reason": "constraint_violation", "message": "never edit prod"})
        try:
            v = ContextKeepInterceptor(socket_path=d.path, timeout_s=1.0).intercept(ctx())
            self.assertEqual(v["decision"], "deny")
            self.assertEqual(v["reason"], "constraint_violation")
            self.assertEqual(d.received[0]["adapter"], "agent-hooks")
            self.assertEqual(d.received[0]["point"], "pre_tool")
        finally:
            d.close()

    def test_survives_a_context_that_is_not_a_dict(self):
        i = ContextKeepInterceptor(socket_path="/tmp/nope.sock", timeout_s=0.2)
        self.assertIn("decision", i.intercept({}))


if __name__ == "__main__":
    unittest.main(verbosity=1)
