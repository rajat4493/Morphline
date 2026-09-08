"""Business Context: enterprise risk facts that cannot reliably be inferred
from a UiPath package and must be explicitly supplied by a human (Section 4).

This is deliberately NOT part of `ProcessModel` — it isn't parsed, it's
entered, and it belongs to the `Automation` (persists across re-uploads),
not to any single `ProcessVersion`. See docs/canonical-model.md.

Every field defaults to UNKNOWN/None. Rule 4 applies here more than
anywhere else in the codebase: a missing field must never be treated as
"NO" or "LOW" by scoring — see `has_critical_unknowns()`.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel

from packages.shared.enums import ImpactLevel, ImpactScope, TriState


class BusinessContext(BaseModel):
    customer_impact: ImpactLevel = ImpactLevel.UNKNOWN
    financial_impact: ImpactLevel = ImpactLevel.UNKNOWN
    legal_regulatory_impact: ImpactLevel = ImpactLevel.UNKNOWN
    employee_impact: ImpactLevel = ImpactLevel.UNKNOWN
    external_party_impact: ImpactLevel = ImpactLevel.UNKNOWN
    maximum_scope: ImpactScope = ImpactScope.UNKNOWN
    monetary_exposure: ImpactLevel = ImpactLevel.UNKNOWN

    human_accountability_required: TriState = TriState.UNKNOWN
    mandatory_approval: TriState = TriState.UNKNOWN
    irreversible_action: TriState = TriState.UNKNOWN
    regulated_process: TriState = TriState.UNKNOWN
    sensitive_data: TriState = TriState.UNKNOWN
    critical_service: TriState = TriState.UNKNOWN

    process_owner: Optional[str] = None
    business_description: Optional[str] = None
    known_policies: Optional[str] = None
    known_constraints: Optional[str] = None
    notes: Optional[str] = None

    def is_supplied(self) -> bool:
        """Whether a human has entered *any* meaningful context at all, as
        opposed to every field sitting at its UNKNOWN/None default."""
        structured_unknown = all(
            v in (ImpactLevel.UNKNOWN, ImpactScope.UNKNOWN, TriState.UNKNOWN)
            for v in (
                self.customer_impact, self.financial_impact, self.legal_regulatory_impact,
                self.employee_impact, self.external_party_impact, self.maximum_scope,
                self.monetary_exposure, self.human_accountability_required,
                self.mandatory_approval, self.irreversible_action, self.regulated_process,
                self.sensitive_data, self.critical_service,
            )
        )
        text_empty = not any(
            (v or "").strip()
            for v in (self.process_owner, self.business_description, self.known_policies, self.known_constraints, self.notes)
        )
        return not (structured_unknown and text_empty)

    def critical_unknown_fields(self) -> list[str]:
        """The specific risk-relevant fields still unknown — used to build
        the INSUFFICIENT_BUSINESS_CONTEXT constraint and the "Missing
        Enterprise Context" panel. Absence of evidence is not evidence of
        safety (Section 13)."""
        unknown: list[str] = []
        if self.customer_impact == ImpactLevel.UNKNOWN:
            unknown.append("customer_impact")
        if self.financial_impact == ImpactLevel.UNKNOWN:
            unknown.append("financial_impact")
        if self.legal_regulatory_impact == ImpactLevel.UNKNOWN:
            unknown.append("legal_regulatory_impact")
        if self.maximum_scope == ImpactScope.UNKNOWN:
            unknown.append("maximum_scope")
        if self.irreversible_action == TriState.UNKNOWN:
            unknown.append("irreversible_action")
        if self.mandatory_approval == TriState.UNKNOWN:
            unknown.append("mandatory_approval")
        if self.regulated_process == TriState.UNKNOWN:
            unknown.append("regulated_process")
        return unknown

    def has_critical_unknowns(self) -> bool:
        return len(self.critical_unknown_fields()) > 0
