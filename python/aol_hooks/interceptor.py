"""AGENT-HOOKS-0.1 interceptor for AOL.

Deliberately takes no runtime dependency on `agent-hooks-sdk`. Python
protocols are structural for our purposes: an object with the right
`intercept` method satisfies a host without importing its classes. That
keeps this shim installable even where the SDK is not, and keeps us
decoupled from a 0.1 spec (docs/07 §A2).
"""

from __future__ import annotations

import time
from typing import Any, Dict, Optional

from .client import PROTOCOL_VERSION, decide

# §3 — the closed set of interception points. Note there is no mutation
# point: that absence is the gap this product exists to fill.
POINT_MAP = {
    "agent_startup": "agent_start",
    "input": "input",
    "pre_model_call": "pre_model",
    "post_model_call": "post_model",
    "pre_tool_call": "pre_tool",
    "post_tool_call": "post_tool",
    "output": "output",
    "agent_shutdown": "agent_end",
}

# §3, §4.3 — transform is not permitted at the lifecycle endpoints.
_NO_TRANSFORM_POINTS = {"agent_startup", "agent_shutdown"}


def transform_permitted(point: str) -> bool:
    return point not in _NO_TRANSFORM_POINTS


def _tool_call_from(ctx: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    point = ctx.get("interception_point")
    if point not in ("pre_tool_call", "post_tool_call"):
        return None
    target = ctx.get("target") or {}
    if not isinstance(target, dict) or not target.get("name"):
        return None
    call: Dict[str, Any] = {"name": target["name"]}
    if target.get("call_id"):
        call["id"] = target["call_id"]
    if "args" in target:
        call["input"] = target["args"]
    if "value" in target:
        call["output"] = target["value"]
    return call


def to_interception(ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Translate an AgentContext into our normalised interception."""
    agent = ctx.get("agent") or {}
    session = ctx.get("session") or {}
    point = ctx.get("interception_point", "")

    ts = int(time.time() * 1000)
    raw_ts = ctx.get("timestamp")
    if isinstance(raw_ts, str):
        try:
            from datetime import datetime

            ts = int(datetime.fromisoformat(raw_ts.replace("Z", "+00:00")).timestamp() * 1000)
        except ValueError:
            pass

    interception: Dict[str, Any] = {
        "protocolVersion": PROTOCOL_VERSION,
        "sessionId": session.get("id", "unknown"),
        "adapter": "agent-hooks",
        "point": POINT_MAP.get(point, "input"),
        "ts": ts,
        "meta": {
            "interceptionPoint": point,
            "sequence": ctx.get("sequence"),
            "agentId": agent.get("id"),
        },
    }
    if agent.get("framework"):
        interception["framework"] = agent["framework"]
    call = _tool_call_from(ctx)
    if call:
        interception["toolCall"] = call
    return interception


def to_verdict(v: Dict[str, Any], point: str) -> Dict[str, Any]:
    """Collapse our five-valued verdict into the spec's three (§5.1).

    `warn` is an allow carrying warnings; `escalate` is a deny carrying an
    approval block. Nothing is lost, but the collapse is deliberate.
    """
    decision = v.get("decision", "allow")
    reason = v.get("reason")
    message = v.get("message")

    if decision == "allow":
        return {"decision": "allow"}

    if decision == "warn":
        warning: Dict[str, Any] = {}
        if reason:
            warning["reason"] = reason
        if message:
            warning["message"] = message
        return {"decision": "allow", "warnings": [warning]}

    if decision == "deny":
        return {"decision": "deny", "reason": reason, "message": message}

    if decision == "escalate":
        # A liftable deny: denied as-is unless the approval seam lifts it.
        return {"decision": "deny", "reason": reason, "message": message, "approval": {}}

    if decision == "transform":
        transform = v.get("transform")
        if not transform_permitted(point) or not transform:
            # Degrade to a warning rather than emit an invalid verdict, which
            # would fail the host closed. The finding stays visible.
            return {
                "decision": "allow",
                "warnings": [
                    {
                        "reason": reason or "transform_not_permitted",
                        "message": message or "repair unavailable at this point",
                    }
                ],
            }
        return {
            "decision": "transform",
            "reason": reason,
            "message": message,
            "transform": {"path": "/extensions/aol_restore", "value": transform.get("restore", [])},
        }

    return {"decision": "allow"}


class AolInterceptor:
    """Context-integrity interceptor.

    Satisfies the AGENT-HOOKS `Interceptor` protocol: one `intercept`
    method taking an AgentContext and returning a Verdict.
    """

    def __init__(self, socket_path: Optional[str] = None, timeout_s: float = 2.0) -> None:
        self._socket_path = socket_path
        self._timeout_s = timeout_s

    def intercept(self, context: Dict[str, Any]) -> Dict[str, Any]:
        # Never raise. A host treats an interceptor exception as a
        # fail-closed deny, so an unhandled error of ours blocks the agent.
        try:
            verdict = decide(to_interception(context), self._socket_path, self._timeout_s)
            return to_verdict(verdict, context.get("interception_point", ""))
        except Exception:
            return {
                "decision": "allow",
                "warnings": [{"reason": "aol_unavailable", "message": "AOL interceptor error; action not evaluated"}],
            }


def create_interceptor(socket_path: Optional[str] = None, timeout_s: float = 2.0) -> AolInterceptor:
    return AolInterceptor(socket_path=socket_path, timeout_s=timeout_s)
