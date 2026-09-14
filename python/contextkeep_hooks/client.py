"""Client for the ContextKeep daemon."""

from __future__ import annotations

import os
import socket
from pathlib import Path
from typing import Any, Dict, Optional

from .protocol import encode_frame, read_frame

PROTOCOL_VERSION = 1
DEFAULT_TIMEOUT_S = 2.0


def default_socket_path() -> str:
    env = os.environ.get("CONTEXTKEEP_SOCKET")
    if env:
        return env
    home = os.environ.get("CONTEXTKEEP_HOME") or str(Path.home() / ".aol")
    preferred = os.path.join(home, "contextkeep.sock")
    # Unix socket paths are capped near 104 bytes on macOS; fall back rather
    # than failing at connect time with a confusing error.
    return preferred if len(preferred) < 100 else "/tmp/contextkeep.sock"


def fail_closed(reason: str) -> Dict[str, Any]:
    """The verdict synthesised when no valid answer can be obtained.

    AGENT-HOOKS-0.1 requires exactly this: a host that cannot reach an
    interceptor, times it out, or receives a malformed verdict must
    synthesise a deny. A gate that fails open is not a gate.
    """
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "decision": "deny",
        "reason": reason,
        "message": f"ContextKeep could not complete a decision ({reason}); denying per fail-closed policy.",
        "detections": [],
    }


def decide(
    interception: Dict[str, Any],
    socket_path: Optional[str] = None,
    timeout_s: float = DEFAULT_TIMEOUT_S,
) -> Dict[str, Any]:
    """Send one interception and await a verdict.

    Never raises. This runs inside somebody's agent, so every failure path
    resolves to an explicit fail-closed deny the caller can act on.
    """
    path = socket_path or default_socket_path()
    sock = None
    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(timeout_s)
        sock.connect(path)
        sock.sendall(encode_frame(interception))
        verdict = read_frame(sock)
        if not isinstance(verdict, dict) or "decision" not in verdict:
            return fail_closed("malformed_verdict")
        return verdict
    except socket.timeout:
        return fail_closed("timeout")
    except (FileNotFoundError, ConnectionRefusedError):
        return fail_closed("unreachable")
    except ConnectionError:
        return fail_closed("closed_before_verdict")
    except Exception:
        return fail_closed("client_error")
    finally:
        if sock is not None:
            try:
                sock.close()
            except OSError:
                pass
