"""Canonical identity normalization (estate brief: "lightweight
normalization layer... deterministic first, aliases, user-confirmable
mappings, optional semantic suggestion later — never rely on LLM alone").

Deterministic rule: strip case/punctuation and purely cosmetic noise tokens
("GUI", "System", "Portal", ...) from a system name, or strip path/prefix/
extension noise from a workflow name. If two raw names reduce to the same
key, they are the same real-world thing with very high confidence — this is
NOT the "ambiguous merge" the brief warns against.

**Environment words are never treated as cosmetic noise.** "SAP PROD",
"SAP UAT", and "SAP DEV" are different real-world dependencies — a
different tenant/instance, usually with different data, availability, and
change-control rules — and collapsing them onto one canonical "SAP" would
be exactly the silently-ambiguous merge the brief prohibits (a review
caught this: an earlier version of this function stripped "production",
"uat", "test", "dev" as noise, which meant "an unlock affects 14
automations" could quietly include automations pointed at a different
environment than the one being fixed). Environment is extracted into its
own field and folded into the key instead of being discarded, so two raw
names only merge automatically when both their cleaned name AND their
environment agree; a bare "SAP" with no environment marker gets its own
UNKNOWN-environment bucket rather than guessing it means PROD.
"""
from __future__ import annotations

import re

_SYSTEM_NOISE_TOKENS = {
    "gui", "system", "app", "application", "portal", "instance",
    "erp", "web", "online", "server",
}

_ENVIRONMENT_TOKENS = {
    "prod": "PROD", "production": "PROD", "live": "PROD",
    "uat": "UAT",
    "test": "TEST", "qa": "TEST", "staging": "TEST", "stage": "TEST",
    "dev": "DEV", "development": "DEV", "sandbox": "DEV",
}

_COMPONENT_NOISE_PREFIXES = (
    "invoke ", "invoke:", "call ", "run ",
)


def extract_environment(raw: str) -> str:
    """Returns 'PROD' | 'UAT' | 'TEST' | 'DEV' | 'UNKNOWN'. Never guesses —
    a name with no environment marker at all is UNKNOWN, not assumed PROD."""
    core = re.sub(r"[^a-z0-9]+", " ", raw.lower()).strip()
    for token in core.split():
        if token in _ENVIRONMENT_TOKENS:
            return _ENVIRONMENT_TOKENS[token]
    return "UNKNOWN"


def normalize_system_key(raw: str) -> str:
    """'SAP GUI', 'SAP ECC' -> 'sap' / 'sap ecc' (ECC is a real product
    distinction, not stripped) — cosmetic/technical noise only. Environment
    words are stripped from *this* key (they get their own dimension via
    `extract_environment`) but the two are combined by `normalize_dependency_key`
    below so PROD/UAT/DEV can never silently fold together."""
    core = re.sub(r"[^a-z0-9]+", " ", raw.lower()).strip()
    tokens = [t for t in core.split() if t not in _SYSTEM_NOISE_TOKENS and t not in _ENVIRONMENT_TOKENS]
    return " ".join(tokens) or core


def normalize_dependency_key(raw: str) -> str:
    """The actual merge key used for identity resolution: cleaned system
    name + environment, so 'SAP Production' and 'SAP UAT' never collapse
    onto each other even though both reduce to the same cleaned name."""
    return f"{normalize_system_key(raw)}::{extract_environment(raw)}"


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
