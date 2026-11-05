#!/usr/bin/env python3
# Import leads from FoodHubbie_Leads_MultiCity.pdf into the live workbook (Leads sheet).
# - adaptive: each city section in the PDF has its own column set, so cells are classified, not positional
# - dedupe: normalized name + last 10 phone digits against existing rows and within the PDF
# - appends rows only (never touches tracked rows); CRM IDs are assigned later by wa-lead-io.py
import re, sys
from pypdf import PdfReader
from openpyxl import load_workbook
from openpyxl.styles import Font, PatternFill, Alignment

PDF = "Restaurant Lead Data/FoodHubbie_Leads_MultiCity.pdf"
XLSX = "Restaurant Lead Data/restaurant-leads.xlsx"
HEAD = 2

PHONE_RE = re.compile(r"(\+?91[\s\d-]{8,})|(\b0\d{2,4}[\s-]\d{3,}[\s-]?\d{0,})")
RATING_RE = re.compile(r"^\d\.\d$")
REVIEWS_RE = re.compile(r"^\d{2,6}$")
TIER_RE = re.compile(r"(TIER\s*\d+\s*-\s*\w+|HOT|WARM|COLD)", re.I)

def norm_name(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())

def phone_digits(s):
    d = re.sub(r"\D", "", s or "")
    if d.startswith("0"):
        d = "91" + d[1:]
    elif d.startswith("91"):
        pass
    elif len(d) == 10:
        d = "91" + d
    return d

def parse_pdf(path):
    rd = PdfReader(path)
    city, rows = "", []
    for page in rd.pages:
        txt = page.extract_text(extraction_mode="layout") or ""
        lines = txt.splitlines()
        i = 0
        while i < len(lines):
            line = lines[i]
            m = re.search(r"Lead Database\s*\|\s*(.+)", line)
            if m:
                city = m.group(1).strip()
                i += 1
                continue
            # numbered row; name cell may be EMPTY (long name wrapped onto its own line below)
            gap = re.match(r"^\s*(\d{1,3})\s{2,}(\s{10,})(.+)$", line)
            norm = re.match(r"^\s*(\d{1,3})\s{2,}(.+)$", line)
            if not (gap or norm):
                i += 1
                continue
            if gap:
                name_below, extra_note = "", []
                if i + 1 < len(lines):
                    nxt_raw = lines[i + 1]; nxt = nxt_raw.strip()
                    indent = len(nxt_raw) - len(nxt_raw.lstrip())
                    parts = [p.strip() for p in re.split(r"\s{2,}", nxt) if p.strip()]
                    if nxt and indent < 60 and parts and not PHONE_RE.search(parts[0]) and len(parts[0]) < 70:
                        name_below, extra_note = parts[0], parts[1:]
                        i += 1
                cells = ([name_below] if name_below else []) + \
                        [c.strip() for c in re.split(r"\s{2,}", gap.group(3)) if c.strip()]
                if extra_note:
                    cells[-1] = (cells[-1] + " " + " ".join(extra_note)).strip()
            else:
                cells = [c.strip() for c in re.split(r"\s{2,}", norm.group(2)) if c.strip()]
            if len(cells) < 3:
                i += 1
                continue
            # notes that wrapped to a far-right column line below
            while i + 1 < len(lines):
                nxt_raw = lines[i + 1]; nxt = nxt_raw.strip()
                if not nxt:
                    break
                indent = len(nxt_raw) - len(nxt_raw.lstrip())
                if indent >= 60 and not re.match(r"^\d", nxt):
                    cells[-1] = (cells[-1] + " " + nxt).strip()
                    i += 1
                else:
                    break
            i += 1
            name = cells[0]
            if not name or name.lower().startswith(("business name", "#")):
                continue
            rest = cells[1:]
            phone = ""
            for c in rest:
                if PHONE_RE.search(c) and sum(ch.isdigit() for ch in c) >= 8:
                    phone = c
                    break
            rating, reviews, category, tier, notes = "", "", "", "", ""
            for ci, c in enumerate(rest):
                if RATING_RE.match(c) and not rating:
                    rating = c
                    for nxt in rest[ci + 1:ci + 3]:
                        if REVIEWS_RE.match(nxt):
                            reviews = nxt
                            break
                    continue
                tm = TIER_RE.search(c)
                if tm and not tier:
                    tier = tm.group(1).upper()
                    if ci >= 1 and not RATING_RE.match(rest[ci - 1]) and not REVIEWS_RE.match(rest[ci - 1]):
                        category = rest[ci - 1]
                    continue
            if not category:
                for c in rest:
                    if re.search(r"[A-Za-z]{4,}", c) and not re.match(r"^(Yes|No|Not Sent)$", c) \
                       and not re.search(r"\d{1,2}(:\d\d)?\s*(AM|PM)", c) and not PHONE_RE.search(c):
                        category = c
                        break
            notes = rest[-1] if rest else ""
            if notes == phone or RATING_RE.match(notes) or REVIEWS_RE.match(notes):
                notes = ""
            # row city: the section header may cover "A & B" — a row cell matching one of them wins
            section_cities = [x.strip() for x in re.split(r"[&,]", city.split(",")[0]) if x.strip()]
            row_city = ""
            for c in rest:
                if any(c.lower() == sc.lower() for sc in section_cities):
                    row_city = c
                    break
            area = ""
            for c in rest[1:]:
                if c != phone and c != "—" and not RATING_RE.match(c) and not REVIEWS_RE.match(c) \
                   and not TIER_RE.search(c) and not re.search(r"\d{1,2}(:\d\d)?\s*(AM|PM)", c) \
                   and not re.match(r"^(Yes|No|Not Sent)$", c) and c != category and c != notes \
                   and c != row_city:
                    area = c
                    break
            city_name = re.sub(r"\s*\(Part \d+ of \d+\)", "", row_city or re.split(r"[&,]", city)[0]).strip()
            rows.append(dict(name=name, area=area, city=city_name, phone=phone,
                             rating=rating, reviews=reviews, category=category,
                             tier=tier, notes=notes))
    return rows

def main():
    replace = "--replace" in sys.argv
    pdf_rows = parse_pdf(PDF)
    wb = load_workbook(XLSX)
    ws = wb["Leads"]
    hdrs = {}
    for c in range(1, ws.max_column + 1):
        v = ws.cell(HEAD, c).value
        if v: hdrs[str(v).strip().lower()] = c
    if replace and "source (query)" in hdrs:
        sc = hdrs["source (query)"]
        doomed = [r for r in range(3, ws.max_row + 1)
                  if str(ws.cell(r, sc).value or "").strip() == "PDF MultiCity"]
        for r in reversed(doomed):
            ws.delete_rows(r, 1)
        print("removed previous PDF import rows:", len(doomed))
    last = HEAD
    for r in range(3, ws.max_row + 1):
        if ws.cell(r, 2).value: last = r
    existing = set()
    for r in range(3, last + 1):
        existing.add(norm_name(ws.cell(r, hdrs["restaurant name"]).value))
        ph = ws.cell(r, hdrs["phone"]).value
        if ph: existing.add("p" + phone_digits(str(ph))[-10:])
    added = dup = 0
    for lead in pdf_rows:
        key_n = norm_name(lead["name"])
        key_p = "p" + phone_digits(lead["phone"])[-10:] if lead["phone"] else ""
        if key_n in existing or (key_p and key_p in existing):
            dup += 1
            continue
        last += 1
        note_bits = []
        if lead["tier"]: note_bits.append(lead["tier"])
        if lead["reviews"]: note_bits.append(f'{lead["reviews"]} reviews')
        if lead["notes"]: note_bits.append(lead["notes"])
        vals = {
            "restaurant name": lead["name"],
            "city / area": (lead["area"] + ", " if lead["area"] else "") + lead["city"],
            "phone": lead["phone"],
            "rating (maps)": lead["rating"],
            "outlet type": lead["category"],
            "status": "New",
            "source (query)": "PDF MultiCity",
            "attempts": 0,
            "notes": " | ".join(note_bits),
            "whatsapp?": "Unknown",
            "dine-in fit (tables)": "Unknown",
        }
        for k, v in vals.items():
            if k in hdrs:
                ws.cell(last, hdrs[k], v)
        # copy the due-date formula pattern with this row's own refs
        if "next dm due (auto)" in hdrs and "next dm due (auto)" in hdrs:
            at = ws.cell(HEAD, hdrs["attempts"]).column_letter
            dt = ws.cell(HEAD, hdrs["last contact"]).column_letter
            f = ws.cell(last, hdrs["next dm due (auto)"])
            f.value = (f'=IF({at}{last}>=3,"seq done",IF({at}{last}=0,"",IF({at}{last}>=2,{dt}{last}+7,'
                       f'IF({at}{last}>=1,{dt}{last}+3,""))))')
            f.number_format = "DD/MM/YYYY"
        existing.add(key_n)
        if key_p: existing.add(key_p)
        added += 1
    wb.save(XLSX)
    print(f"PDF rows parsed: {len(pdf_rows)} | added: {added} | duplicates skipped: {dup}")

if __name__ == "__main__":
    main()
