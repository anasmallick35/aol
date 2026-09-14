"""Wire protocol: 4-byte big-endian length, then UTF-8 JSON.

Mirrors packages/core/src/protocol.ts exactly. Kept dependency-free on
purpose: this shim is imported into other people's agents, and every
dependency we add is one they did not choose.
"""

from __future__ import annotations

import json
import socket
import struct
from typing import Any

HEADER_BYTES = 4
MAX_FRAME_BYTES = 16 * 1024 * 1024


class FrameTooLargeError(Exception):
    pass


def encode_frame(value: Any) -> bytes:
    body = json.dumps(value, separators=(",", ":")).encode("utf-8")
    if len(body) > MAX_FRAME_BYTES:
        raise FrameTooLargeError(f"frame of {len(body)} bytes exceeds {MAX_FRAME_BYTES}")
    return struct.pack(">I", len(body)) + body


def read_frame(sock: socket.socket) -> Any:
    """Read exactly one frame. Sockets give no message boundaries, so a
    frame may arrive split across reads and must be reassembled."""
    header = _read_exactly(sock, HEADER_BYTES)
    (size,) = struct.unpack(">I", header)
    if size > MAX_FRAME_BYTES:
        raise FrameTooLargeError(f"declared frame of {size} bytes exceeds {MAX_FRAME_BYTES}")
    return json.loads(_read_exactly(sock, size).decode("utf-8"))


def _read_exactly(sock: socket.socket, n: int) -> bytes:
    chunks = []
    remaining = n
    while remaining > 0:
        chunk = sock.recv(remaining)
        if not chunk:
            raise ConnectionError("socket closed before a complete frame arrived")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)
