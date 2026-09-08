"""Pure resolution logic for folding a raw observed name (a System name, an
invoked-workflow filename) into a `CanonicalDependency`. No DB access here
— by design, matching the rest of the codebase's separation between pure
logic (`scoring/`, `recommendation/`) and DB orchestration
(`apps/api/app/*_service.py`). See estate/normalize.py for the actual
matching rule.
"""
from __future__ import annotations

from packages.shared.enums import Confidence
from packages.shared.estate_types import AliasMapping, CanonicalDependency, DependencyKind
from estate.normalize import extract_environment, normalize_component_key, normalize_dependency_key


def normalized_key_for(kind: DependencyKind, raw_name: str) -> str:
    """The merge key used for identity resolution. For SYSTEM this includes
    environment (see estate/normalize.py) so 'SAP PROD' and 'SAP UAT' never
    fold together even though both clean to 'sap'."""
    if kind == DependencyKind.SYSTEM:
        return normalize_dependency_key(raw_name)
    return normalize_component_key(raw_name)


def resolve(
    existing: list[CanonicalDependency], kind: DependencyKind, raw_name: str
) -> tuple[CanonicalDependency, bool, bool]:
    """Finds or creates the CanonicalDependency this raw name belongs to.

    Returns (dependency, is_new_dependency, alias_added). Callers persist
    the result (`is_new_dependency` → insert a new row; `alias_added` →
    update the existing row's aliases). Matching a raw name to an existing
    entry via identical normalized key is a deterministic signal — safe to
    fold in automatically, per the brief's "deterministic normalization
    first" rule. This function never merges two *different* normalized
    keys — that requires an explicit, separately-tracked user confirmation
    (see apps/api/app/routers/estate.py's merge-alias endpoint).
    """
    key = normalized_key_for(kind, raw_name)

    for dep in existing:
        if dep.kind == kind and dep.normalized_key == key:
            if raw_name in {a.raw for a in dep.aliases}:
                return dep, False, False
            dep.aliases.append(AliasMapping(raw=raw_name, confidence=Confidence.INFERRED, user_confirmed=False))
            return dep, False, True

    new_dep = CanonicalDependency(
        kind=kind,
        canonical_name=raw_name,
        normalized_key=key,
        environment=extract_environment(raw_name) if kind == DependencyKind.SYSTEM else None,
        aliases=[AliasMapping(raw=raw_name, confidence=Confidence.KNOWN, user_confirmed=True)],
    )
    return new_dep, True, True
