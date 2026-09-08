# User Acceptance Testing (UAT) Guide

This guide is written for someone who wants to verify Morphline works
correctly **without reading any code**. Follow it top to bottom the first
time; after that, use individual sections to re-check a specific area.

If a step says "you should see X" and you see something else, that's a
failure — write down exactly what you saw and which step you were on.

---

## 1. Launching Morphline

You need two things running at once: the backend (the "brain") and the
frontend (the web page you look at).

**Backend:**
```bash
cd Morphline
python3 -m venv .venv          # first time only
source .venv/bin/activate
pip install -r apps/api/requirements.txt   # first time only
python -m apps.api.scripts.seed_samples    # loads 8 sample processes — optional but recommended
uvicorn apps.api.app.main:app --reload --port 8000
```
Leave this running. You should see `Uvicorn running on http://127.0.0.1:8000`.

**Frontend**, in a second terminal:
```bash
cd Morphline/apps/web
npm install     # first time only
npm run dev
```
Leave this running too. You should see `Local: http://localhost:3000`.

**Open** `http://localhost:3000` in a browser.

✅ **Pass:** you see a page titled "Workspaces" with a "Sample Workspace"
listed (assuming you ran `seed_samples`), showing 8 automations.
❌ **Fail:** a blank page, a "Failed to fetch" error, or a connection
error. Usually means the backend isn't running, or is running on a
different port than the frontend expects (check `NEXT_PUBLIC_API_URL`).

---

## 2. First look: open a sample process

1. Click "Sample Workspace."
2. You should see an **estate dashboard**: a colored bar ("Evolution
   Funnel"), and cards for "Quick Wins," "High-Risk Migrations," "Newly
   Eligible," "Requires Architect Review," and "Top Constraints."
3. Click on **"Customer Exclusion Review (Sample)."**

✅ **Pass:** a process detail page opens with tabs: Overview, Process Flow,
Evolution Assessment, Why / Why Not, Business Context, Dependencies,
Constraints, Evolution History, Evidence.

---

## 3. Checking the Overview tab makes sense

On the Overview tab for **Customer Exclusion Review**, you should see:

- Four boxes: **Current State**, **Recommended State**, **Maximum Safe
  State**, **Next Possible State**. Current State should read "Augmented
  RPA," Recommended and Maximum Safe should both read "Hybrid Agent."
- A **Recommended Migration Pattern** box reading "Hybrid with Human
  Approval."
- A box titled **"Current Implementation vs. Reasoning Opportunity"**
  showing two separate ratings side by side — these are allowed to
  disagree, and for this sample they should (Current AI Usage: MEDIUM,
  Reasoning Opportunity: HIGH).
- "Top Reasons" and "Top Blockers" cards.
- A yellow **"Missing Enterprise Context"** box listing things like
  "Runtime Stability: no evidence available" and Business Context fields
  not yet supplied.

❌ **Fail:** if Recommended State ever shows "High Autonomy" or "Advanced
Hybrid" for this process *before* you've entered any Business Context —
that would mean the safety ceiling isn't working (this process mutates a
customer record and nothing about it has been confirmed safe yet).

---

## 4. Verifying "Why This" is sensible

Click the **"Why / Why Not"** tab.

The left card ("Why Hybrid Agent?") should list plain-English reasons that
reference specific dimension names — e.g. "Reasoning Opportunity is HIGH,"
"Execution Tool Readiness is HIGH." Each reason should be something you
could independently check against the Evolution Assessment tab (the
dimension it names should actually show that level there).

✅ **Pass:** every reason in "Why This" points at a real, checkable fact.
❌ **Fail:** a reason that's vague ("this seems like a good fit") or that
contradicts what the Evolution Assessment tab actually shows for that
dimension.

---

## 5. Verifying "Why Not Further" is sensible

Still on "Why / Why Not," look at the right card ("Why Not Further?").
Each reason has a small colored badge before it:

- **BLOCKED** (red) — a confirmed risk stands in the way.
- **UNKNOWN** (grey) — something hasn't been confirmed yet.
- **NOT READY** (amber) — tooling/observability isn't there yet.
- **NOT VALUABLE** (blue) — going further wouldn't actually help.

For Customer Exclusion Review **before** you enter Business Context, every
badge should read **UNKNOWN** — because nothing about this process's
customer/compliance impact has been confirmed yet, the system is honest
that it doesn't *know* these are real problems, only that they're
unconfirmed. It should NOT say BLOCKED yet.

✅ **Pass:** badges match this logic — confirmed facts get BLOCKED,
unconfirmed inferences get UNKNOWN, missing tooling gets NOT READY, and a
process with genuinely nothing left to gain from more autonomy gets NOT
VALUABLE (try this on "Nightly Ledger Reconciliation (Sample)" — its
Why Not Further should include a NOT VALUABLE or NOT READY reason, never a
false BLOCKED).
❌ **Fail:** an unconfirmed guess labeled BLOCKED, or a real confirmed risk
labeled UNKNOWN.

---

## 6. Testing Business Context

1. On **Customer Exclusion Review**, click the **"Business Context"** tab.
2. You'll see a short form — under ten questions, not a long
   questionnaire. Everything defaults to UNKNOWN.
3. Set "Does this process affect customers?" to **HIGH**, "Is a regulated
   process?" to **YES**, "Is mandatory human approval required?" to
   **YES**, "Are its actions difficult to reverse?" to **YES**.
4. Click **"Save & Reassess."**

✅ **Pass:**
- The button shows "Saving & reassessing…" briefly, then finishes.
- Go back to the **Overview** tab: Recommended State is still "Hybrid
  Agent" (it was already capped there), but now go to **"Why / Why Not"**
  — the badges for compliance and reversibility should now read **BLOCKED**
  instead of UNKNOWN, because you just confirmed those facts.
- Go to the **Constraints** tab — you should see constraints whose
  description mentions "confirmed by Business Context."
- Go to **Evolution History** — a new "REASSESSMENT" entry should appear,
  mentioning "Business Context changed."

❌ **Fail:** nothing changes after saving, or the badges still say UNKNOWN
after you've explicitly confirmed YES to those questions.

---

## 7. Testing reassessment (re-uploading a changed process)

1. Go to a workspace, click **"Upload Process."**
2. Upload any of the fixture zips again (see §9 below for how to make one),
   but this time check **"automation_id"** is set to an existing
   automation rather than creating a new one — in the UI, this happens
   automatically if you re-upload from the automation's own page (a future
   convenience); for now this is most easily tested via the API directly:
   ```bash
   curl -X POST http://localhost:8000/workspaces/1/uploads \
     -F "automation_id=<the automation's numeric id from its URL>" \
     -F "file=@fixtures/uipath/invoice_processing.zip"
   ```
   (zip the fixture folder first: `cd fixtures/uipath && zip -r ../../invoice_processing.zip invoice_processing`)
3. Reload the automation's page.

✅ **Pass:** a new entry appears under **Evolution History**, and the
**Evolution Assessment** tab reflects the newly uploaded version. The
process's older assessment is not deleted — you can still see it existed
via the history timeline.

---

## 8. Testing constraint memory

1. On any process with active constraints (e.g. "Invoice Processing
   (Sample)"), go to the **Constraints** tab.
2. Each constraint card shows: category, severity, status (ACTIVE), a
   description, evidence grouped by type, a **"Resolves when"** line, and
   sometimes an owner.

✅ **Pass:** the "Resolves when" text is a concrete, actionable condition
(e.g. "Wrap the UI automation in a reusable, argument-bound subprocess"),
not a vague restatement of the problem.

3. Now test that constraints don't get falsely marked as certainly
   resolved: change something that would make a constraint's *category*
   stop firing but where the original evidence was only inferred (for
   example, supplying `regulated_process: NO` after it was previously
   inferred from keywords only). Re-check the Constraints tab.

✅ **Pass:** if the constraint had confirmed (fully known) evidence, it now
shows status **RESOLVED**. If the constraint's evidence was only inferred,
it shows **POSSIBLY RESOLVED** with a note to confirm — never a plain,
confident "resolved" checkmark for something that was never confirmed.

---

## 9. Testing a real, sanitized UiPath process

**Do not upload anything containing real customer data, real credentials,
or production secrets.** Sanitize first (see `SECURITY.md`).

1. Export or copy a real UiPath project folder (containing `project.json`
   and one or more `.xaml` files).
2. Remove/replace any real credentials, connection strings, or personal
   data in selectors, arguments, or asset names.
3. Zip the folder: the zip's top level should contain `project.json`
   directly (not nested one level deeper inside another folder).
4. Upload it via "Upload Process."

✅ **Pass:** the process parses without an error page. Check the
**Overview** tab's "Parser Warnings" box (if present) — warnings about
unclassified activities are expected and fine (real projects use activity
types this simplified parser doesn't recognize yet); a crash or a blank
process is not.
❌ **Fail:** an HTTP 400/500 error, or a process with zero workflows/steps
when the zip clearly contained XAML files (check the zip's internal
structure — the parser looks for `project.json` at the top level of the
archive).

---

## 10. Testing an "RPA-as-tool" recommendation

This checks that Morphline doesn't automatically reject UI automation as
unsafe when it's packaged as a reusable subprocess.

1. Open **"Order Fulfillment via Reusable Subprocesses (Sample)"** (seeded
   by `seed_samples.py`).
2. Go to **Overview**. Recommended Migration Pattern should read
   **"Agent-Orchestrated RPA Tools."**
3. Go to **Evolution Assessment**, find "Execution Tool Readiness" — it
   should be **HIGH**, and its evidence (Evidence tab) should explicitly
   mention "reusable invoked workflow(s) with declared arguments... usable
   as bounded deterministic tools even though they use UI automation
   internally."
4. Go to **Constraints** — there should be **no** "Unstable UI Dependency"
   constraint for this process, even though it's built entirely on UI
   automation.

✅ **Pass:** matches the above — UI automation wrapped in a well-defined
subprocess is treated as a legitimate tool, not a blocker.
❌ **Fail:** this process gets capped at Augmented RPA with an "unstable UI
dependency" constraint, the same as a process with raw, unencapsulated UI
clicking.

---

## 11. Quick regression pass (run after any code change)

```bash
source .venv/bin/activate
pytest -q
```
✅ **Pass:** all tests pass (58 at the time this guide was written).
❌ **Fail:** any test failure — read the failure message, it names the
exact expectation that broke.

Also rebuild the frontend to catch type errors:
```bash
cd apps/web && npm run build
```
✅ **Pass:** "Compiled successfully."
