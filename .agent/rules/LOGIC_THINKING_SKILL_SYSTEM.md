# 🧩 LOGIC THINKING OF THE CLAUDE SKILL SYSTEM
> The complete cognitive architecture — how Claude reads a request,
> selects a skill, enters a reasoning loop, executes, and delivers output.
> Built for OpenCode models to replicate frontier-level thinking depth.

---

## OVERVIEW — What Is a "Skill"?

A **Skill** is a specialized module of knowledge + rules + tools
that Claude loads before tackling a specific category of task.

```
Without Skill:     Request → Generic reasoning → Output (mediocre)
With Skill:        Request → Skill Load → Specialized reasoning → Output (precise)
```

Think of it like a surgeon who carries a general medical degree (base model)
but picks up the RIGHT instrument tray before each procedure (skill).

The skill system is what separates **capable** from **excellent**.

---

## PART 1 — THE SKILL TRIGGER LOGIC

---

### 1.1 — HOW CLAUDE DECIDES TO LOAD A SKILL

Before any task involving file creation, code execution, or domain-specific output,
Claude scans the available skill list and asks:

```
┌────────────────────────────────────────────────────┐
│  SKILL TRIGGER DECISION TREE                       │
│                                                    │
│  Does this task touch a FILE FORMAT?               │
│  ├── .docx / .doc         → LOAD docx skill        │
│  ├── .pdf (create/fill)   → LOAD pdf skill         │
│  ├── .pdf (read/extract)  → LOAD pdf-reading skill │
│  ├── .pptx / .ppt         → LOAD pptx skill        │
│  ├── .xlsx / .xls / .csv  → LOAD xlsx skill        │
│  └── uploaded file (any)  → LOAD file-reading skill│
│                                                    │
│  Does this task involve UI / FRONTEND?             │
│  └── web, component, UI   → LOAD frontend-design   │
│                                                    │
│  Does this task ask about ANTHROPIC PRODUCTS?      │
│  └── Claude API, pricing  → LOAD product-knowledge │
│                                                    │
│  None of the above?                                │
│  └── Use base reasoning (no skill needed)          │
└────────────────────────────────────────────────────┘
```

> 🔑 RULE: The skill check is **unconditional and always first**.
> Claude does NOT decide whether the task "probably needs" a skill.
> It reads the skill and lets the skill define what it covers.

---

### 1.2 — SKILL TRIGGER VOCABULARY

These words and patterns in a user request TRIGGER a skill load:

| User Says... | Triggers... |
|---|---|
| "Word doc", "docx", "report", "memo", "letter" | `docx` skill |
| "PDF", "fill a form", "merge PDFs", "watermark" | `pdf` skill |
| "read this PDF", "extract from PDF", "what's in this PDF" | `pdf-reading` skill |
| "presentation", "slides", "deck", ".pptx" | `pptx` skill |
| "spreadsheet", "Excel", ".xlsx", "chart the data" | `xlsx` skill |
| Any `/mnt/user-data/uploads/` path or uploaded file | `file-reading` skill |
| "website", "component", "UI", "dashboard", "landing page" | `frontend-design` skill |
| "Claude API", "pricing", "Claude Code", "Sonnet", "Opus" | `product-self-knowledge` skill |

---

### 1.3 — MULTI-SKILL TASKS

Some tasks require more than one skill. Claude loads ALL relevant ones:

```
User: "Read this PDF and turn it into a Word document"
      → LOAD pdf-reading skill (to read the source)
      → LOAD docx skill (to create the output)

User: "Create a React dashboard from this Excel data"
      → LOAD xlsx skill (to read/parse the data)
      → LOAD frontend-design skill (to build the UI)

User: "Make a presentation from this uploaded PDF"
      → LOAD pdf-reading skill
      → LOAD pptx skill
```

> 🔑 RULE: Loading multiple skills is additive. Constraints from each skill
> stack — never assume one skill's rules override another's.

---

## PART 2 — THE SKILL READING LOGIC

---

### 2.1 — WHAT CLAUDE DOES WHEN IT OPENS A SKILL FILE

When Claude opens a `SKILL.md`, it runs this internal parse:

```
STEP 1: READ THE HEADER METADATA
        name: What is this skill for?
        description: What exact triggers apply?
        license: Any restrictions on use?

STEP 2: IDENTIFY THE CONSTRAINT SECTIONS
        What are the HARD RULES? (things prefixed with CRITICAL, NEVER, ALWAYS)
        What are the PATTERNS? (code templates, structure templates)
        What are the DECISION TABLES? (dispatch tables, comparison matrices)

STEP 3: MAP CONSTRAINTS TO THE CURRENT TASK
        Which rules apply to THIS specific request?
        Which code patterns match what I'm about to build?
        What pitfalls are listed that I would have stepped into otherwise?

STEP 4: INTERNALIZE BEFORE GENERATING
        Do NOT generate output and then check constraints.
        Apply constraints DURING generation, not after.

STEP 5: VALIDATE BEFORE DELIVERING
        Does the output match every CRITICAL rule in the skill?
        If not → fix before presenting.
```

---

### 2.2 — THE CONSTRAINT PRIORITY STACK

When a skill has rules, they are ranked:

```
PRIORITY 1 — NEVER / CRITICAL rules
             (Hard rules — violating them breaks the output)
             Example: "NEVER use unicode bullets in docx"
             Example: "NEVER cat a PDF — it prints binary garbage"

PRIORITY 2 — ALWAYS / REQUIRED rules
             (Mandatory patterns — omitting them degrades quality)
             Example: "Always set page size explicitly"
             Example: "Always stat before reading large files"

PRIORITY 3 — PREFER / RECOMMEND rules
             (Best practices — follow unless context dictates otherwise)
             Example: "Prefer DXA over percentage for table widths"
             Example: "Prefer CSS-only animations in HTML artifacts"

PRIORITY 4 — EXAMPLES / TEMPLATES
             (Starting points — adapt to the task)
```

---

### 2.3 — HOW CLAUDE READS A DISPATCH TABLE

Many skills contain dispatch tables — routing maps that say
"given input X, use tool/method Y".

**Example from file-reading skill:**
```
Extension → First Move → Dedicated Skill
.pdf      → pdfinfo    → pdf-reading/SKILL.md
.docx     → extract-text → docx/SKILL.md
.xlsx     → extract-text → xlsx/SKILL.md
.csv      → pandas nrows → (inline, no deeper skill)
```

**Claude's logic when reading a dispatch table:**

```
1. Look up the input type in the LEFT column
2. Read the FIRST MOVE — execute this before anything else
3. If a DEDICATED SKILL is listed → load and read that skill too
4. If no dedicated skill → the current skill has full coverage
5. Never skip the first move even if you "think" you know what to do
```

> 🔑 RULE: Dispatch tables are not suggestions. They encode
> hard-won trial-and-error. The "naive" path (e.g., `cat file.pdf`)
> is explicitly listed in the skill as WRONG. Trust the table.

---

## PART 3 — COGNITIVE LOOPS INSIDE SKILL EXECUTION

---

### 3.1 — THE SKILL EXECUTION LOOP

Once a skill is loaded and the task is understood, Claude enters this loop:

```
┌─────────────────────────────────────────────────────────┐
│                 SKILL EXECUTION LOOP                    │
│                                                         │
│  ┌─────────────┐                                        │
│  │   ORIENT    │ ← Read skill constraints               │
│  │             │   Classify the exact subtask           │
│  └──────┬──────┘   Map constraints to this instance    │
│         │                                               │
│         ▼                                               │
│  ┌─────────────┐                                        │
│  │    PLAN     │ ← What steps are needed?               │
│  │             │   What order? What dependencies?       │
│  └──────┬──────┘   What could go wrong at each step?   │
│         │                                               │
│         ▼                                               │
│  ┌─────────────┐                                        │
│  │   EXECUTE   │ ← Run each step                        │
│  │             │   Apply skill constraints inline       │
│  └──────┬──────┘   Don't generate then validate        │
│         │           (validate DURING generation)        │
│         ▼                                               │
│  ┌─────────────┐                                        │
│  │   VERIFY    │ ← Does output satisfy all CRITICAL     │
│  │             │   rules from the skill?                │
│  └──────┬──────┘   If NO → return to EXECUTE to fix    │
│         │           If YES → proceed to DELIVER         │
│         ▼                                               │
│  ┌─────────────┐                                        │
│  │   DELIVER   │ ← Present output + any caveats        │
│  └─────────────┘   Share file, show code, explain      │
└─────────────────────────────────────────────────────────┘
```

---

### 3.2 — THE "NAIVE PATH" AVOIDANCE PATTERN

Every skill documents the **naive path** — the thing an untrained model
would do, and why it fails. Claude actively avoids these:

| Domain | Naive Path | Why It Fails | Correct Path |
|---|---|---|---|
| PDF reading | `cat file.pdf` | Prints binary garbage | `pdfinfo` → `pdftotext` |
| DOCX bullets | `"• Item"` unicode char | Renders inconsistently | `LevelFormat.BULLET` with numbering config |
| XLSX row count | Trust `ws.max_row` | Returns None/wrong in read-only | Iterate or use pandas |
| PPTX legacy | Open `.ppt` with python-pptx | Raises exception | Convert to `.pptx` via LibreOffice first |
| Table width | `WidthType.PERCENTAGE` | Breaks in Google Docs | Always use `WidthType.DXA` |
| Archive reading | Auto-extract ZIP | Can be huge, path traversal risk | List first, never auto-extract |
| UI fonts | Arial, Inter, Roboto | Generic "AI slop" aesthetic | Choose distinctive, contextual fonts |

> 🔑 RULE: If you feel the urge to take a shortcut — the skill has almost
> certainly documented why that shortcut fails. Stop and re-read.

---

### 3.3 — INCREMENTAL VALIDATION LOGIC

For long or complex tasks, Claude does not wait until the end to validate.
It validates incrementally at checkpoints:

```
COMPLEX TASK EXAMPLE: Create a 20-slide PowerPoint

Checkpoint 1: After loading skill
  → Confirmed: pptxgenjs is the library, not python-pptx
  → Confirmed: Legacy .ppt files need conversion first
  → Confirmed: Scripts path, validation command

Checkpoint 2: After generating structure
  → Does each slide have required elements?
  → Are font sizes within readable ranges?
  → Are image aspect ratios correct?

Checkpoint 3: After generating full file
  → Run validation script
  → Check for empty slides
  → Verify all relationships intact

Checkpoint 4: Before delivering
  → File opens without errors?
  → Output matches the user's request?
```

---

### 3.4 — ERROR RECOVERY WITHIN SKILL CONTEXT

When something fails during skill execution:

```
FAILURE DETECTION:
  "Did the tool call return an error?"
  "Does the output look wrong even without an explicit error?"
  "Did validation fail?"

DIAGNOSIS:
  1. Re-read the relevant section of the skill
  2. Check if this is a documented pitfall (usually it is)
  3. Identify which specific rule was violated

RECOVERY:
  Option A — PATCH: Fix the specific violation, re-run
  Option B — RESTART: If corruption is deep, start the affected
             section over from scratch using correct patterns
  Option C — FALLBACK: If primary method fails, use the skill's
             documented fallback (e.g., pandoc as fallback for extract-text)

NEVER:
  × Silently ignore an error and deliver broken output
  × Retry the same approach that already failed
  × Pretend the error didn't happen
```

---

## PART 4 — DOMAIN-SPECIFIC LOGIC PATTERNS

---

### 4.1 — FILE TYPE READING LOGIC (file-reading skill)

The core logic pattern: **Size → Type → Tool → Depth**

```
PHASE 1: SIZE CHECK
         stat -c '%s' <file>
         → Under 20KB:  read fully
         → 20KB–1MB:    sample (head/tail)
         → Over 1MB:    targeted reads only (grep, nrows, page ranges)

PHASE 2: TYPE IDENTIFICATION
         extension → dispatch table lookup
         if unknown: `file <path>` → magic byte identification

PHASE 3: TOOL SELECTION
         Binary formats (pdf, docx, xlsx): specialized extractor
         Text formats (csv, json, md): direct read with sampling
         Archives: list only, never auto-extract
         Images: already in context as vision input

PHASE 4: DEPTH CALIBRATION
         "How much do I actually need to answer the question?"
         → User asked "how many rows?" → wc -l, not full load
         → User asked "summarize this document" → extract full text
         → User asked "fix the formula in cell B12" → load that sheet
```

---

### 4.2 — DOCUMENT CREATION LOGIC (docx/pptx/xlsx skills)

The core logic pattern: **Setup → Structure → Content → Validate → Pack**

```
SETUP:
  Install required library (docx, pptxgenjs, openpyxl)
  Read skill to confirm correct import patterns
  Set page size / dimensions EXPLICITLY (never use defaults blindly)

STRUCTURE:
  Define the skeleton before filling content
  For docx: sections → headings → body → tables
  For pptx: master → layouts → slides → elements
  For xlsx: workbook → sheets → headers → data rows → formulas

CONTENT:
  Apply formatting via styles, not inline hacks
  Use numbering config for lists (never unicode chars)
  Use DXA units for measurements (never percentage in docx tables)
  Use ShadingType.CLEAR not SOLID for table fills

VALIDATE:
  Run validation script after generation
  Check file opens without errors
  Verify all relationships (images, fonts, links) are intact

PACK:
  Save to /home/claude first (working dir)
  Copy to /mnt/user-data/outputs/ for delivery
  Call present_files to make visible to user
```

---

### 4.3 — FRONTEND DESIGN LOGIC (frontend-design skill)

The core logic pattern: **Intent → Direction → Differentiation → Execution**

```
INTENT:
  What problem does this interface solve?
  Who uses it? What's their mental model?
  What's the emotional register? (professional, playful, urgent, calm)

DIRECTION (choose ONE and commit):
  Brutally minimal / Editorial magazine / Retro-futuristic /
  Luxury refined / Industrial utilitarian / Organic natural /
  Maximalist chaos / Art deco geometric / Soft pastel...

  ← Choose a direction BEFORE writing any code
  ← The direction determines EVERY design decision that follows

DIFFERENTIATION:
  What makes this unforgettable?
  What ONE thing will a user remember?
  What unexpected choice will surprise them pleasantly?

EXECUTION:
  Typography: distinctive pair (display + body), NOT Inter/Roboto/Arial
  Color: CSS variables, dominant + accent, commit fully
  Motion: high-impact moments (page load, hover states) > scattered micro
  Layout: asymmetry, overlap, diagonal — break the grid intentionally
  Background: atmosphere > flat color (gradient mesh, noise, pattern)
```

---

### 4.4 — THE "JUST ENOUGH" READING PRINCIPLE

Claude reads only as much of the source material as needed to answer.
This applies to both skill files AND user-uploaded files:

```
QUESTION TYPE → HOW MUCH TO READ

"What is the first line?" → head -1 only
"Summarize the document" → full extract
"Fix the bug on line 47" → lines 40-55, context window around it
"How many rows?" → wc -l, no content read
"What does the chart show?" → read only chart data, not full sheet
"Is there a section on X?" → grep for X, then read surrounding context
"Translate the whole thing" → full extract required
```

> 🔑 RULE: Reading more than needed wastes context window.
> Context window is the most precious resource in any AI task.
> Spend it deliberately, not accidentally.

---

## PART 5 — CROSS-CUTTING LOGIC PRINCIPLES

---

### 5.1 — THE SKILL-FIRST PRINCIPLE

```
WRONG SEQUENCE:
  User asks → Claude writes code from memory → Code fails →
  Claude reads skill → Realizes mistake → Fixes (wasted effort)

CORRECT SEQUENCE:
  User asks → Claude reads skill → Claude writes correct code →
  Output works first time (efficient, no waste)
```

The skill read is not overhead. It IS the work.
A 30-second skill read prevents a 10-minute debugging session.

---

### 5.2 — CONSTRAINT INTERNALIZATION vs. CONSTRAINT CHECKING

Two modes of applying skill rules:

```
MODE A — CHECKING (weak, error-prone):
  Generate output → Read constraints → Compare → Fix violations
  Problem: You might generate something so wrong it's hard to fix
           You might miss violations during the check
           You've already wasted generation effort

MODE B — INTERNALIZATION (strong, correct):
  Read constraints → Hold them in working memory → Generate with
  constraints active → Output is correct from the start
  
  This is how expert humans work. A carpenter doesn't cut the wood
  and then check if it fits — they measure first, cut once.
```

> 🔑 TARGET: Always operate in Mode B. Read skill → internalize →
> generate correctly. Not: generate → check → fix.

---

### 5.3 — THE FALLBACK CHAIN LOGIC

When the primary tool/method fails, skills define fallback chains.
Claude follows them in order:

```
EXAMPLE: Text extraction from uploaded file

Primary:    extract-text <file>
Fallback 1: pandoc <file> -t plain
Fallback 2: language-specific library (python-docx, openpyxl)
Fallback 3: Unpack the file and read raw XML

NEVER:
  × Skip the primary and jump to fallback "to be safe"
  × Try all fallbacks simultaneously
  × Give up after primary fails without trying fallbacks
```

---

### 5.4 — IMPLICIT KNOWLEDGE IN SKILLS

Skills contain two types of knowledge:

```
EXPLICIT KNOWLEDGE:
  "Use WidthType.DXA, never WidthType.PERCENTAGE"
  "Run pdffonts before pdftotext"
  Directly stated rules — easy to follow

IMPLICIT KNOWLEDGE:
  WHY each rule exists
  WHAT failure mode the rule prevents
  WHEN the rule matters most

Example:
  Explicit: "Use read_only=True in openpyxl"
  Implicit: Without it, openpyxl loads the ENTIRE workbook into memory.
            A 50MB Excel file will crash your process or flood your context.
            The skill author learned this from a real failure.
```

> 🔑 Reading the implicit knowledge (the "why") turns rule-following
> into judgment. With judgment, you can handle cases the skill didn't
> explicitly document.

---

### 5.5 — SKILL COMPOSITION PATTERN

When multiple skills are loaded, apply this composition logic:

```
STEP 1: Identify all required skills
STEP 2: Read ALL of them before generating anything
STEP 3: Build a unified constraint set
         (merge all NEVER/CRITICAL rules from all skills)
STEP 4: Identify any conflicts between skills
         (rare, but resolve by taking the more restrictive rule)
STEP 5: Execute with the unified constraint set active
```

**Example — PDF to DOCX task:**
```
From pdf-reading skill:
  → Never cat a PDF
  → Run pdffonts to check for text layer first
  → Use pdftotext for digital PDFs, OCR for scans

From docx skill:
  → Never use unicode bullets
  → Set page size explicitly
  → Use DXA for table widths

Combined constraint set: All of the above, simultaneously active
```

---

## PART 6 — META-LOGIC: HOW SKILLS IMPROVE OUTPUT QUALITY

---

### 6.1 — WHAT SKILLS PREVENT

Skills exist because models fail in predictable, documented ways.
Each skill rule maps to a known failure pattern:

| Skill Rule | Failure It Prevents |
|---|---|
| Never `cat` a PDF | Thousands of lines of binary garbage in context |
| Always `pdffonts` before `pdftotext` | "Empty extraction" on scanned PDFs, appears as failed tool call |
| `read_only=True` in openpyxl | Memory crash on large Excel files |
| Don't trust `ws.max_row` | Row count returns `None`, code breaks |
| Set page size explicitly | A4 default causes wrong layout for US Letter users |
| Never use percentage table widths | Tables render incorrectly in Google Docs |
| Use `ShadingType.CLEAR` not `SOLID` | Table cells render with black background |
| List archives before extracting | Path traversal attacks, multi-GB extractions |
| Never use Inter/Roboto for UI | Output looks like every other AI-generated UI |

---

### 6.2 — THE EXPERTISE ACCELERATION MODEL

Without skills, a model learns through trial-and-error in the conversation.
With skills, the model inherits accumulated expertise instantly.

```
WITHOUT SKILLS:
  Model generates → Fails → User reports error →
  Model adjusts → Might fail again → Eventually converges
  Time to correct output: Multiple turns, user frustration

WITH SKILLS:
  Model reads skill (distilled expertise) → Generates correctly
  Time to correct output: First attempt
```

Skills are **compressed experience**. The constraint "never use unicode bullets
in docx" represents someone discovering that bug, debugging it, documenting it,
and encoding the fix. Loading the skill gives you that lesson for free.

---

### 6.3 — SKILL CONFIDENCE CALIBRATION

After reading a skill, Claude knows which areas it has strong guidance on
vs. where it must reason independently:

```
HIGH CONFIDENCE (skill has explicit rule):
  → Follow the rule. Do not improvise.

MEDIUM CONFIDENCE (skill has examples but no explicit rule for this case):
  → Extrapolate from the examples using the skill's spirit/intent
  → Stay consistent with the documented patterns

LOW CONFIDENCE (skill doesn't cover this case):
  → Apply general first principles
  → Flag uncertainty to user if relevant
  → Do NOT invent a "rule" and present it as if the skill said it
```

---

## PART 7 — QUICK REFERENCE

---

### The Skill Logic Flowchart (Compact)

```
REQUEST RECEIVED
      │
      ▼
SCAN skill list → Does any skill match?
      ├── YES → READ all matching skills (mandatory, unconditional)
      │          ↓
      │         BUILD unified constraint set
      │          ↓
      │         PLAN execution with constraints active
      │          ↓
      │         EXECUTE (validate inline, not after)
      │          ↓
      │         VERIFY against all CRITICAL rules
      │          ↓
      │         DELIVER
      │
      └── NO → Base reasoning pipeline (see AGENT_RULES.md)
```

### The 7 Laws of Skill-Based Thinking

```
LAW 1: Read the skill BEFORE generating anything.
LAW 2: The skill's CRITICAL/NEVER rules are absolute — no exceptions.
LAW 3: Dispatch tables are deterministic — look up, don't guess.
LAW 4: The naive path is documented because it fails — avoid it.
LAW 5: Read only as much source data as the question requires.
LAW 6: Validate during generation, not after.
LAW 7: When skills conflict, take the more restrictive rule.
```

### Skill → Domain Mapping (Quick Reference)

```
docx skill          → Word documents (.docx creation, editing, tracked changes)
pdf skill           → PDF creation, filling, merging, splitting, watermarking
pdf-reading skill   → PDF content extraction, OCR, reading strategies
pptx skill          → PowerPoint presentations (.pptx creation and editing)
xlsx skill          → Excel spreadsheets (data, formulas, charts)
file-reading skill  → Any uploaded file (router to correct tool/skill)
frontend-design     → Web UI, React components, HTML/CSS, dashboards
product-knowledge   → Claude API, models, pricing, features, Claude Code
```

---

*Load this file alongside AGENT_RULES.md and ANALYSIS_AND_SEARCH_STRATEGY.md
to give your OpenCode model a complete three-layer cognitive stack:
task intake + analytical reasoning + specialized domain execution.*
