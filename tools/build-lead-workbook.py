# builds "Restaurant Lead Data/restaurant-leads.xlsx" from promo/leads/*.csv
# re-run any time new scrape CSVs land:
#   python tools/build-lead-workbook.py
# PII: whole folder is gitignored � business contacts never committed.
import csv, glob, os, sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.utils import get_column_letter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_DIR = os.path.join(ROOT, "promo", "leads")
OUT_DIR = os.path.join(ROOT, "Restaurant Lead Data")
os.makedirs(OUT_DIR, exist_ok=True)
OUT = os.path.join(OUT_DIR, "restaurant-leads.xlsx")

HDR_FILL = PatternFill("solid", fgColor="1F2937")
HDR_FONT = Font(bold=True, color="FFFFFF", size=11)
GROUP_FILL = {"scout": PatternFill("solid", fgColor="374151"),
              "outreach": PatternFill("solid", fgColor="9A3412")}
THIN = Border(bottom=Side(style="thin", color="D1D5DB"))

COLS = [
    ("#", "scout", 5, None),
    ("Restaurant name", "scout", 30, None),
    ("City / Area", "scout", 20, None),
    ("Rating (Maps)", "scout", 12, None),
    ("Phone", "scout", 16, None),
    ("WhatsApp?", "scout", 11, "wa"),
    ("Website", "scout", 22, None),
    ("Google Maps link", "scout", 45, None),
    ("Owner name", "scout", 18, None),
    ("Outlet type", "scout", 13, "outlet"),
    ("Dine-in fit (tables)", "scout", 14, "fit"),
    ("On delivery apps?", "scout", 14, "apps"),
    ("Source (query)", "scout", 22, None),
    ("Found on", "scout", 11, None),
    # ---- outreach pipeline ----
    ("Status", "outreach", 16, "status"),
    ("Channel used", "outreach", 14, "channel"),
    ("Attempts", "outreach", 9, None),
    ("First contact", "outreach", 12, None),
    ("Last contact", "outreach", 12, None),
    ("Reply summary", "outreach", 36, None),
    ("Demo date", "outreach", 12, None),
    ("Trial start", "outreach", 12, None),
    ("Plan pitched", "outreach", 26, None),
    ("Est. �/month (own math)", "outreach", 16, None),
    ("Objections", "outreach", 30, None),
    ("Next action", "outreach", 28, None),
    ("Next action date", "outreach", 14, None),
    ("Outcome", "outreach", 18, "outcome"),
    ("Notes", "outreach", 34, None),
]
GROUP_HEADERS = ("LeadScout � fill these first", "NegotiationTracker � fill as you pitch")

DV = {
    "wa": '"Yes,No,Unknown,WA link on Maps"',
    "outlet": '"Cafe,Restaurant,Fine dining,Quick service,Bakery/Cloud kitchen,Multicuisine"',
    "fit": '"Unknown,<5 tables,5-10,10-20,20+,No dine-in"',
    "apps": '"Unknown,Yes Zomato,Yes Swiggy,Yes both,No"',
    "status": '"New,Contacted,Replied,Demo scheduled,Demo done,Trial,Signed,Not interested,Unreachable/Wrong no,Duplicate"',
    "channel": '"WhatsApp,Phone,Walk-in,FB/IG,Email,Referral"',
    "outcome": '",Signed,Not interested,Later (revist date set),No outlet fit,Competitor installed"',
}

def read_csv_rows():
    rows, seen = [], set()
    for f in sorted(glob.glob(os.path.join(CSV_DIR, "*.csv"))):
        src = os.path.basename(f.rsplit("-", 2)[0])
        with open(f, encoding="utf-8", newline="") as fh:
            for r in csv.DictReader(fh):
                name = (r.get("name") or "").strip()
                if not name:
                    continue
                import re as _re
                key = _re.sub(r"[^a-z0-9]", "", name.lower())
                dup = key in seen
                seen.add(key)
                area = ""
                addr = (r.get("addr") or "").replace('"', "")
                low = name.lower()
                outlet = "Cafe" if ("cafe" in low or "coffee" in low or "bakery" in low) else "Restaurant"
                rows.append(dict(name=name, phone=(r.get("phone") or "").strip(),
                                 website=(r.get("website") or "").strip(),
                                 maps=(r.get("href") or "").strip(), addr=addr,
                                 outlet=outlet, source=src, dup=dup))
    return rows

def sheet_readme(wb):
    ws = wb.create_sheet("READ ME")
    ws["A1"] = "Restaurant Lead Data � negotiation tracker"
    ws["A1"].font = Font(bold=True, size=14)
    lines = [
        "",
        "How to work a lead (always in this order):",
        "1. Scout fill (columns B-N): name/area/phone/type/fit � fill Owner name + WhatsApp? by checking the website or calling once.",
        "2. WhatsApp is the channel: send Pitch Kit DM #1. Set Status=Contacted, Channel used, First contact date.",
        "3. Each follow-up: attempts +1, Last contact updated, Reply summary one line.",
        "4. Booked demo � Demo date. Running trial � Trial start. Where it ends � Outcome.",
        "5. Never cold-blast: this list is for individual founder-sent messages only � never the bot/promo transport.",
        "",
        "Status meanings:",
        "  New            scraped, nothing sent yet",
        "  Contacted      DM sent, no reply yet",
        "  Replied        any human reply (even 'raha nahi')",
        "  Demo scheduled demo booked with a date",
        "  Demo done      demo happened, waiting for decision",
        "  Trial          outlet running FoodHubbie free (log start date)",
        "  Signed         paying � move numbers into TRACKER.md weekly KPIs",
        "  Not interested said no (log objection verbatim � it feeds copy fixes)",
        "  Unreachable    dead number / never opens",
        "",
        "Weekly ritual (promo/TRACKER.md): qualified conversations � demos � signed; ",
        "spend cap �5k/month total on outreach (calls/visits), stop rule applies.",
        "",
        "Sourcing new batches (see tools/gmaps-lead-scraper.cjs):",
        '  node tools/gmaps-lead-scraper.cjs "cafes in <area> <city>" 15 1',
        "Then re-run this script to merge new CSVs, or paste rows manually.",
        "",
        "Field guide � where each scout value comes from:",
        "  Rating (Maps): listing page. Owner name: website Team/About page or first call.",
        "  WhatsApp?: 'WA link on Maps' if listing shows a wa.me button; else call and ask politely.",
        "  Dine-in fit: photos of the listing (tables visible?) � this is the QR-ordering pitch anchor.",
        "  On delivery apps: check Zomato/Swiggy search by name � matters for the delivery-billing pitch.",
    ]
    for i, t in enumerate(lines, start=2):
        ws.cell(row=i, column=1, value=t)
    ws.column_dimensions["A"].width = 110
    ws.sheet_view.showGridLines = False

def sheet_leads(wb, rows):
    ws = wb.create_sheet("Leads")
    ws.freeze_panes = "C2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(COLS))}{len(rows)+1}"
    # group banners
    group1 = ("LeadScout � fill these first", )
    ws.cell(row=1, column=1, value=group1[0]).font = Font(bold=True, color="D97706", size=11)
    span1 = next(idx for idx, cb in enumerate(COLS, start=1) if cb[1] == "outreach") - 1
    ws.cell(row=1, column=span1 + 1, value=GROUP_HEADERS[1]).font = Font(bold=True, color="9A3412", size=11)
    for j, c in enumerate(COLS, start=1):
        cell = ws.cell(row=2, column=j, value=c[0])
        cell.fill = HDR_FILL; cell.font = HDR_FONT
        cell.alignment = Alignment(vertical="center", wrap_text=True)
        ws.column_dimensions[get_column_letter(j)].width = c[2]
        if len(COLS[0]) and c[3]:
            dv = DataValidation(type="list", formula1=DV[c[3]], allow_blank=True, showErrorMessage=False)
            ws.add_data_validation(dv)
            col = get_column_letter(j)
            dv.add(f"{col}3:{col}{len(rows)+2}")
    ws.row_dimensions[2].height = 30
    for i, r in enumerate(rows, start=3):
        vals = [i-2, r["name"], r.get("addr", ""), "", r["phone"], "Unknown", r["website"],
                r["maps"], "", r["outlet"], "Unknown", "Unknown", r["source"], ""]
        for j, v in enumerate(vals, start=1):
            c = ws.cell(row=i, column=j, value=v)
            c.border = THIN
        k = len(vals) + 1
        status = "Duplicate" if r["dup"] else "New"
        note = "same name in another batch  kept the first"
        for name_, default in (("status", status), ("channel", "WhatsApp"), ("attempts", 0)):
            j = next(idx for idx, cc in enumerate(COLS, start=1) if cc[0].lower().startswith(name_))
            ws.cell(row=i, column=j, value=default).border = THIN
        if r["dup"]:
            jn = next(idx for idx, cc in enumerate(COLS, start=1) if cc[0] == "Notes")
            ws.cell(row=i, column=jn, value=note).border = THIN
        ws.cell(row=i, column=k-1).border = THIN
    ws.sheet_view.zoomScale = 90

def sheet_pitch(wb):
    ws = wb.create_sheet("Pitch Kit")
    ws.column_dimensions["A"].width = 120
    txt = """PITCH KIT \u2014 Founder outreach (from promo/COPY.md)

DM #1 (Hinglish, WhatsApp):
"Namaste \U0001F64F [Owner name] ji, main Nilesh \u2014 FoodHubbie se.
Aapke restaurant ke liye ek cheez dikhani thi: counter billing, table QR order, kitchen screen aur WhatsApp order \u2014 sab ek hi dashboard mein.
Charges per order hain, monthly nahi: counter \u20b91, table QR \u20b92, WhatsApp \u20b95. Setup \u20b9500 one-time. Cancel order ka charge nahi.
10 minute ka demo de doon? Aapke menu se hi dikha dunga."

DM #1 (English):
"Hi [Name], Nilesh here from FoodHubbie.
Quick one: we put counter billing, table QR ordering, the kitchen screen and WhatsApp orders on one dashboard.
You pay per order, not per month \u2014 \u20b91 counter, \u20b92 table QR, \u20b95 WhatsApp. \u20b9500 one-time setup. Cancelled orders are never billed.
Can I show you a 10-minute demo using your own menu?"

Personalise before sending (non-negotiable, else it's just spam):
1. [Owner name] \u2014 one look at the listing/photos first; if unknown, "Namaste ___ ji, manager sahab se baat ho sakti hai?"
2. One lead-specific hook from scout columns, e.g.:
   - Dine-in fit 10+ tables  \u2192  "aapke tables par QR se order aayega to staff order daalne nahi bhagega"
   - On Zomato/Swiggy \u2192 "delivery orders bhi usi dashboard mein aate hain (\u20b95/order)"
   - No website \u2192 "WhatsApp pe menu + order, store nahi banana padega"

Follow-up (24-48h later, one only):
"Sir nahi dekh baithe? 32-second ka video hai \u2014 poora system chalte hue: kitchen tak, tables tak. Dekh lijiye, pasand aaye to 10 min demo."
Attach: <repo>/website/assets/demo/demo-walkthrough-32s.mp4 (or hosted link)

Phone script (30 seconds):
"Namaste ji \u2014 Nilesh, FoodHubbie se. Ek quick sawaal: aapka table-order ka bill aur counter ka bill same jaggah par banta hai?  ... Ji bilkul, hum wahi solve karte hain. 10 minute mein dikhata hoon \u2014 aapke hi menu se."

Numbers you may quote (exact, from billing policy):
- \u20b91 counter order, \u20b92 table QR order, \u20b95 WhatsApp order (ya 1% of that order \u2014 choice, not "whichever is lower")
- \u20b91 promo message (Meta conversation charge alag), \u20b9500 one-time setup (first bill mein adjust)
- No monthly fee, no minimum, no lock-in \u2014 cancelled/refunded orders never billed

Objection one-liners:
- "new software seekhna mushkil"  \u2192 "Ek dopahar. Staff ko sirf counter screen chahiye, baki sab system khud karta hai."
- "abhi POS hai"                  \u2192 "POS rakhiye \u2014 QR table aur WhatsApp orders usi dashboard mein aayenge. Dono ko chalana."
- "WhatsApp mein order koi nahi karega" \u2192 "Menu ka link + QR cards aate hain pehle 10 din. Jo table use kare wahi bhi \u20b92 hi lagega \u2014 risk naam ka bhi nahi."
- "price zyada"                   \u2192 "Har order ke paise ke barabar. Agar din mein 50 order hain, poora system \u20b9150-250 mein chal gaya. Aapka waiter ko dijiye to \u20b9150 nahi dilwata."

Demo flow (15 min): 1) unka menu + ek table QR live 2) unke phone se order karo 3) KDS confirm \u2192 Ready dikhao 4) bill + \u20b9 breakdown 5) WhatsApp order demo 6) "live trial" \u2192 10 din free trial offer, baad mein \u20b9500 setup.
After demo \u2192 follow-up email within 24h (promo/COPY.md). Ask for the Google review only after paying (Pitch Kit rule)."""
    for i, line in enumerate(txt.split("\n"), start=1):
        ws.cell(row=i, column=1, value=line)
    ws.sheet_view.showGridLines = False

def main():
    rows = read_csv_rows()
    print("HEADER", len(rows), "leads CSV")
    wb = Workbook()
    wb.remove(wb.active)
    sheet_readme(wb)
    sheet_leads(wb, rows)
    sheet_pitch(wb)
    wb.save(OUT)
    print("WROTE", OUT, os.path.getsize(OUT), "bytes")

if __name__ == "__main__":
    main()
