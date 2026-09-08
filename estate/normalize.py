"""Canonical identity normalization (estate brief: "lightweight
normalization layer... deterministic first, aliases, user-confirmable
mappings, optional semantic suggestion later — never rely on LLM alone").

Deterministic rule: strip case/punctuation and common noise tokens
("GUI", "Production", "System", ...) from a system name, or strip path/
prefix/extension noise from a workflow name. If two raw names reduce to
the same key, they are the same real-world thing with very high
confidence — this is NOT the "ambiguous merge" the brief warns against.
Ambiguous merging (two different keys a human believes refer to the same
thing) requires an explicit, separately-tracked confirmation and is never
automatic.
"""
from __future__ import annotations

import re

_SYSTEM_NOISE_TOKENS = {
    "gui", "production", "prod", "system", "app", "application", "portal",
    "instance", "environment", "env", "test", "uat", "dev", "erp", "live",
    "web", "online", "server",
}

_COMPONENT_NOISE_PREFIXES = (
    "invoke ", "invoke:", "call ", "run ",
)


def normalize_system_key(raw: str) -> str:
    """'SAP Production', 'SAP GUI', 'SAP ECC' -> 'sap' (well, 'sap' /
    'sap ecc' — ECC is a real product distinction, not stripped)."""
    core = re.sub(r"[^a-z0-9]+", " ", raw.lower()).strip()
    tokens = [t for t in core.split() if t not in _SYSTEM_NOISE_TOKENS]
    return " ".join(tokens) or core


def normalize_component_key(raw: str) -> str:
    """'Shared/CustomerLookup.xaml', 'Invoke Customer Lookup',
    'CustomerLookup.xaml' -> 'customerlookup' / 'customer lookup'."""
    name = raw.strip()
    lowered = name.lower()
    for prefix in _COMPONENT_NOISE_PREFIXES:
        if lowered.startswith(prefix):
            name = name[len(prefix):]
            break
    name = name.replace("\\", "/").split("/")[-1]
    name = re.sub(r"\.xaml$", "", name, flags=re.IGNORECASE)
    core = re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()
    return core
