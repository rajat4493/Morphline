/** Fixed label set for exception texts. The model may only choose from these; anything else becomes `other_unclear`. */
export const EXCEPTION_CATEGORIES = ["document_input", "classification_ambiguity", "reference_data_missing", "validation_rule", "approval_required", "ui_fragility", "system_unavailable", "access_credentials", "other_unclear"] as const;
export type ExceptionCategory = (typeof EXCEPTION_CATEGORIES)[number];

export const CATEGORY_INFO: Record<ExceptionCategory, { label: string; description: string }> = {
  document_input: { label: "Document / input quality", description: "Unrecognised layout, OCR or extraction confidence, unreadable or unstructured attachment or message" },
  classification_ambiguity: { label: "Classification / routing ambiguity", description: "Category, intent or destination cannot be determined; several candidates; needs judgment" },
  reference_data_missing: { label: "Reference data missing", description: "A lookup, master-data record, vendor, customer or entity was not found" },
  validation_rule: { label: "Explicit validation rule", description: "A stated business rule or field validation failed (format, threshold, mismatch)" },
  approval_required: { label: "Approval required", description: "A human approval or authorisation decision is missing or pending" },
  ui_fragility: { label: "UI fragility", description: "Selector, element, window or screen not found or timed out in UI automation" },
  system_unavailable: { label: "System unavailable", description: "Timeouts, 5xx errors, connectivity, locks, licence or capacity problems" },
  access_credentials: { label: "Access / credentials", description: "Login, permission, credential or MFA failure" },
  other_unclear: { label: "Other / unclear", description: "None of the above, or too little text to tell" },
};

/** Categories where the failure is about judgment/inputs (an AI capability could plausibly help) vs. plumbing or data. */
export const JUDGMENT_CATEGORIES: ExceptionCategory[] = ["classification_ambiguity"];
export const DOCUMENT_CATEGORIES: ExceptionCategory[] = ["document_input"];
