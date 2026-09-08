# Security

This describes what is (and isn't) safe about handling untrusted UiPath
packages in this personal V0, per Rule 5 and Section 19 of the product
brief. Read this before uploading anything containing real credentials or
production data.

## What this product does with an uploaded file

1. The raw bytes are validated: extension allowlist (`.nupkg`, `.zip`,
   `.xaml`, `.json`), size cap, sanitized filename
   (`parser/uipath/extract.py::prepare_upload`).
2. Archives are extracted into an **isolated temporary directory** created
   fresh per upload (`extraction_dir()`), never into a shared or
   predictable location.
3. Every archive entry path is validated against path traversal (`../`),
   absolute paths, and Windows drive-letter paths before being written to
   disk (`_validate_member_path`). A single suspicious entry aborts the
   entire extraction rather than silently skipping it.
4. Per-file and total-uncompressed-size limits are enforced during
   extraction to prevent zip-bomb-style resource exhaustion.
5. Extracted files have their permission bits reset (`chmod 0o644`) —
   an archive cannot mark its own contents executable.
6. The extracted content is parsed as **data only** — read as text/XML and
   walked as a tree. Nothing extracted is ever executed, `eval`'d,
   `exec`'d, imported as a Python/`.NET` module, or shelled out to.
7. The temporary directory (archive and all extracted content) is deleted
   as soon as parsing completes, via a `try/finally` in the
   `extraction_dir()` context manager — including on parse failure.
8. Nothing from the upload is written to permanent storage except the
   **derived canonical `ProcessModel`** (structured JSON — activity names,
   selectors, dependency names, etc.), stored in the local SQLite database.

## What is NOT currently protected (accepted risk for personal V0)

Be aware of these before pointing this at anything sensitive:

- **No malware/AV scanning** of uploaded archive contents. An archive
  containing a malicious `.xaml` cannot execute anything through this
  product's parser (it's read as inert XML), but if you separately open an
  uploaded file with UiPath Studio outside this product, normal UiPath
  execution risks apply — this product does not change those.
- **No authentication.** Anyone with network access to the local server
  can upload, view, and download everything. This is fine for a single
  developer running it on `localhost`; it is **not** fine to expose this
  process to an untrusted network without adding auth first.
- **No secret redaction beyond what's structurally impossible to extract.**
  Selector strings, endpoint URLs, and dependency/workflow names are stored
  as-is in the canonical model and may appear in narrative summaries. If
  your UiPath project embeds credentials directly in a selector or
  hardcoded string (bad practice, but it happens), that string could be
  captured in the parsed model and, if an LLM provider is enabled, sent to
  that provider. **Sanitize test data before uploading it if it contains
  real secrets**, and prefer the default `NullLLMProvider` (no network
  calls, see `docs/architecture.md`) unless you've reviewed what a
  configured LLM provider receives.
- **No rate limiting or upload quota enforcement** beyond the single
  per-request size cap.
- **The SQLite database file (`morphline.db`) is unencrypted** on disk.
  Anyone with filesystem access to the machine can read every uploaded
  process's parsed structure.

## What must change before any enterprise deployment

See `docs/enterprise-deployment.md` and `docs/uipath-orchestrator-future.md`
for the target architecture. Concretely, before this touches real customer
data or a shared network:

- Add authentication + per-workspace authorization.
- Move archive extraction into an isolated worker/container per upload
  (defense in depth beyond the current in-process temp-dir sandboxing).
- Add AV/malware scanning of uploaded archives.
- Add secret-pattern detection/redaction on extracted selector and string
  attribute values before they enter the canonical model or reach any LLM
  provider.
- Encrypt the database at rest and in transit (Postgres + TLS, per
  `docs/architecture.md`'s planned migration).
- Add audit logging of who uploaded/viewed/exported what.
- Formal compliance review (SOC 2 / ISO 27001 / customer-specific) — none
  of the above claims any compliance certification.

## Reporting a concern

This is a personal development project at this stage; if you find a real
vulnerability while reviewing this code, please open an issue describing
it rather than exploiting it against any deployed instance.
