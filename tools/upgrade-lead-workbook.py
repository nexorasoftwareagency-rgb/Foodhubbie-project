#!/usr/bin/env python3
# In-place Excel template upgrade for Restaurant Lead Data/restaurant-leads.xlsx.
# NEVER regenerates the sheet (that would reset manual tracking). Idempotent: re-run is safe.
# Adds: Msg lang (hi/en), Demo scheduled, Demo outcome, "Next DM due (auto)" formula column,
#       real date cells for first/last contact (so formulas work), status colour coding,
#       READ ME + Pitch Kit notes for the 3-message sequence.
import re, sys
from datetime import datetime
from openpyxl import load_workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import CellIsRule

XLSX = sys.argv[1] if len(sys.argv) > 1 else "Restaurant Lead Data/restaurant-leads.xlsx"
wb = load_workbook(XLSX)
ws = wb["Leads"]

HEAD = 2  # header row
def cols():
    h = {}
    for c in range(1, ws.max_column + 1):
        v = ws.cell(HEAD, c).value
        if v: h[str(v).strip().lower()] = c
    return h

def last_row():
    r = HEAD
    for x in range(3, ws.max_row + 1):
        if ws.cell(x, 2).value: r = x
    return r

h = cols()
nextc = max(h.values()) + 1
added = []

h = cols()
nextc = max(h.values()) + 1
added = []

def add_col(name, width=14, wrap=False):
    global nextc
    if name.strip().lower() in h:
        return h[name.strip().lower()]
    c = ws.cell(HEAD, nextc, name)
    c.font = Font(bold=True, color="FFFFFF")
    c.fill = PatternFill("solid", fgColor="1F2937")
    c.alignment = Alignment(wrap_text=wrap, vertical="center")
    ws.column_dimensions[c.column_letter].width = width
    h[name.strip().lower()] = nextc
    nextc += 1
    added.append(name)
    return h[name.strip().lower()]

# cleanup pass: an earlier run may have added a duplicate "demo scheduled" column while
# the template already ships "Demo date" — delete it and drop its data validation.
if "demo scheduled" in h:
    idx = h.pop("demo scheduled")
    letter = ws.cell(HEAD, idx).column_letter
    ws.delete_cols(idx, 1)
    kept = []
    for dv in list(ws.data_validations.dataValidation):
        if letter in str(dv.sqref):
            ws.data_validations.dataValidation.remove(dv)
        else:
            kept.append(dv)
    h = {}  # indices shifted — rebuilt just below
    added.append("-demo scheduled (dup of Demo date, removed)")
# recompute columns + tail after possible deletion
h = cols()
nextc = max(h.values()) + 1

# --- new tracking columns ---
lang_col  = add_col("msg lang", 10)
demo_col  = add_col("demo scheduled", 14, wrap=True) if not any("demo date" in k for k in h) else h[[k for k in h if "demo date" in k][0]]  # reuse existing scheduling column
dout_col  = add_col("demo outcome", 14)
due_col   = add_col("next dm due (auto)", 15)

rl = last_row()
for r in range(3, rl + 1):
    # real dates for first/last contact (text dd/mm/yyyy -> date)
    for k in ("first contact", "last contact"):
        c = h.get(k)
        if not c: continue
        v = ws.cell(r, c).value
        if isinstance(v, str) and re.fullmatch(r"\d{1,2}/\d{1,2}/\d{4}", v.strip()):
            d = datetime.strptime(v.strip(), "%d/%m/%Y").date()
            ws.cell(r, c, d)
            ws.cell(r, c).number_format = "DD/MM/YYYY"
    # next-dm-due formula: attempts 1 -> +3d, 2 -> +7d, 0 -> (dm1 pending), >=3 -> done
    at = ws.cell(r, h["attempts"]).column_letter
    dt = ws.cell(r, h["last contact"]).column_letter
    f = ws.cell(r, due_col)
    f.value = (f'=IF({at}{r}>=3,"seq done",IF({at}{r}=0,"",IF({at}{r}>=2,{dt}{r}+7,'
               f'IF({at}{r}>=1,{dt}{r}+3,""))))')
    f.number_format = "DD/MM/YYYY"
    ws.cell(r, lang_col, ws.cell(r, lang_col).value or "")  # keep blanks consistent

# --- dropdowns (existing rows + headroom) ---
def dropdown(col, items):
    dv = DataValidation(type="list", formula1='"' + ",".join(items) + '"', allow_blank=True, showDropDown=False)
    ws.add_data_validation(dv)
    dv.add(f"{ws.cell(2, col).column_letter}3:{ws.cell(2, col).column_letter}{rl + 30}")
dropdown(lang_col, ["hi", "en"])
dropdown(dout_col, ["Done", "No-show", "Signed", "Lost"])

# sanitize: dedupe validations, drop any that now sit on the formula column (artifacts of column deletion)
import re as _re
due_letter = ws.cell(2, h["next dm due (auto)"]).column_letter
seen = set()
for dv in list(ws.data_validations.dataValidation):
    sq = str(dv.sqref); f1 = str(dv.formula1)
    letter = _re.match(r"\$?([A-Z]{1,2})\$?\d", sq)
    ltr = letter.group(1) if letter else ""
    if ltr == due_letter or (sq, f1) in seen:
        ws.data_validations.dataValidation.remove(dv); continue
    seen.add((sq, f1))

# dedupe CF rules (same status rule may have been added on an earlier run)
cfd = ws.conditional_formatting._cf_rules
for key in list(cfd.keys()):
    rules = cfd[key]
    seenf, keep = set(), []
    for rule in rules:
        f = str(rule.formula[0]) if rule.formula else None
        if f and f in seenf: continue
        seenf.add(f); keep.append(rule)
    if len(keep) != len(rules): cfd[key] = keep

def trim_dup(sheet, marker):
    hits = [i for i in range(1, sheet.max_row + 1) if marker in str(sheet.cell(i, 1).value or "")]
    for start in hits[1:]:  # keep the first block, drop later duplicates to sheet end
        sheet.delete_rows(start, sheet.max_row - start + 1)

trim_dup(wb["READ ME"], "WHAT THE AGENT AUTOMATES")
trim_dup(wb["Pitch Kit"], "DM SEQUENCE - live copy")

# --- status colour coding (idempotent) ---
if "status" in h:
    col_letter = ws.cell(2, h["status"]).column_letter
    rng = f"{col_letter}3:{col_letter}{rl}"
    present = set()
    for cf in ws.conditional_formatting:
        cf_rng = str(cf.sqref)
        if cf_rng.startswith(f"{col_letter}3:"):
            for rule in cf.rules:
                if rule.formula: present.add(str(rule.formula[0]))
    fills = {
        "New": "F1F5F9", "Contacted": "FEF3C7", "Replied": "D1FAE5",
        "Demo scheduled": "DBEAFE", "Demo done": "EDE9FE", "Trial": "CCFBF1",
        "Signed": "A7F3D0", "Not interested": "FEE2E2",
        "Unreachable/Wrong no": "FECACA", "Duplicate": "E5E7EB",
    }
    for val, hexc in fills.items():
        if f'"{val}"' in present:
            continue
        ws.conditional_formatting.add(rng, CellIsRule(operator="equal", formula=[f'"{val}"'],
                                                      fill=PatternFill("solid", fgColor=hexc)))

# --- READ ME notes (idempotent) ---
rm = wb["READ ME"]
if not any("WHAT THE AGENT AUTOMATES" in str(rm.cell(i, 1).value or "") for i in range(1, rm.max_row + 1)):
    notes = [
        "",
        "WHAT THE AGENT AUTOMATES (2026-10-22)",
        "1. DM sequence runs itself: DM1 on first send, follow-up 3 days later, final notice 7 days after that - then the agent stops (Attempts column tracks 1/2/3).",
        "2. 'next dm due (auto)' shows which lead needs its next message today. It is a formula - do not type into it.",
        "3. 'msg lang' column: hi = Hinglish body (default), en = proper English body. Greetings stay Hinglish (Namaste) in both.",
        "4. 'Demo date' / 'demo outcome': book the 10-min demo on the call, mark Done / No-show / Signed / Lost.",
        "5. Set status manually: Replied (after you answer), Demo scheduled, Signed, Not interested (agent freezes these forever), Resend (jumps the 3/7-day wait).",
        "6. Everything the agent sends/receives is also in wa-log.csv (same folder) with full message text.",
        "7. If a contact date cell is blank but Attempts > 0, the due column errors - set 'Last contact' to the real date (DD/MM/YYYY).",
    ]
    for i, line in enumerate(notes, start=rm.max_row + 1):
        rm.cell(i, 1, line)

# --- Pitch Kit: snapshot of live bilingual copy (idempotent) ---
if "Pitch Kit" in wb.sheetnames and not any(
        "DM SEQUENCE - live copy" in str(pk_cell.value or "") for pk_cell in
        [wb["Pitch Kit"].cell(i, 1) for i in range(1, wb["Pitch Kit"].max_row + 1)]):
    pk = wb["Pitch Kit"]
    row0 = pk.max_row + 2
    blocks = [
        ("DM SEQUENCE - live copy inside tools/wa-sales-agent.cjs (2026-10-22). Edit agent, not this sheet.", True),
        ("DM1 EN: Namaste... I'm Nilesh from FoodHubbie. Utility: counter/table-QR/WhatsApp/kitchen in one dashboard. Pricing: Rs1/Rs2/Rs5 per order + Rs500 one-time setup (first bill). Demo ask: reply 'yes'.", False),
        ("DM1 HI: Namaste... Main Nilesh, FoodHubbie se. Counter/Table-QR/WhatsApp orders + kitchen ek dashboard. Pricing: 1/2/5 rupaye per order + 500 one-time (first bill mein adjust). Demo ask: 'haan' likhiye.", False),
        ("DM2 (day 3) EN: following up - 10-min demo on your menu, or 32-sec video first. Live demo or video - your call.", False),
        ("DM2 (day 3) HI: pichhle message pe follow-up - aapke menu pe 10-min demo, ya pehle 32-sec video. Live/video - jo aasan ho.", False),
        ("DM3 (day 7) EN: final follow-up - system ready if billing/orders ever need simplifying (site link). 'I won't message you again after this.'", False),
        ("DM3 (day 7) HI: aakhri follow-up - system ready hai (site link). 'Ab aapke taraf se message nahi aayega.'", False),
        ("OPT-OUT words that freeze a lead: stop / band karo / nahi chahiye / not interested / mat bhejo / raha nahi / unsub", True),
    ]
    for i, (txt, bold) in enumerate(blocks):
        cell = pk.cell(row0 + i, 1, txt)
        cell.font = Font(bold=bold)
        cell.alignment = Alignment(wrap_text=True, vertical="top")
        pk.row_dimensions[row0 + i].height = 30 if not bold else 18

wb.save(XLSX)
print("UPGRADED:", ", ".join(added) if added else "(columns already present - formulas/colours refreshed only)")
