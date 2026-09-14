"""ContextKeep — context integrity for AI agents.

An AGENT-HOOKS-0.1 interceptor that asks whether an agent still knows what
it needed to know.
"""

from .client import PROTOCOL_VERSION, decide, default_socket_path, fail_closed
from .interceptor import (
    POINT_MAP,
    ContextKeepInterceptor,
    create_interceptor,
    to_interception,
    to_verdict,
    transform_permitted,
)

__version__ = "0.1.0"
__all__ = [
    "ContextKeepInterceptor",
    "create_interceptor",
    "decide",
    "default_socket_path",
    "fail_closed",
    "to_interception",
    "to_verdict",
    "transform_permitted",
    "POINT_MAP",
    "PROTOCOL_VERSION",
]
