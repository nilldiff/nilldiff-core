"""Makes the synthetic card-statement fixtures (invented numbers, invented merchant names).
Layout mimics a two-column card statement: summary boxes on the right of page 1 sharing rows with left-column text, posting-date asterisks,
multi-line descriptions, date-only lines under a hotel charge, and Pay In Full / Pay Over Time / Account Total balance blocks.
Run: python3 tests/fixtures/gen-card.py"""
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
import os
HERE = os.path.dirname(os.path.abspath(__file__))
M = lambda c: f"${c/100:,.2f}" if c >= 0 else f"-${-c/100:,.2f}"
PAY = [("11/20/26*", "MOBILE PAYMENT - THANK YOU", -120000), ("12/02/26*", "ONLINE PAYMENT - THANK YOU", -300050)]
CRED = [("11/28/26", "SUMMIT OUTLET RETURN", "PORTLAND OR", -8520, ["DEPARTMENT STORE"])]
CHG = [("11/12/26", "ACME SUPPLY CO", "AUSTIN TX", 31075, ["+15125550100"]), ("11/18/26", "CLOUDHOST INC", "SEATTLE WA", 4900, ["cloudhost.example"]),
       ("11/21/26", "HOTEL LINDEN PORTLAND", "PORTLAND OR", 41236, ["Arrival Date  Departure Date", "11/18/26  11/21/26", "LODGING"]),
       ("11/23/26*", "TRANSACTION PROCESSED BY BANK", "", 1500, ["CARD RENTAL PROTECTION"]), ("12/01/26", "PRINT SHOP 12", "DENVER CO", 12840, []),
       ("12/05/26", "FUEL STOP 221", "BOISE ID", 6412, []), ("12/10/26", "SOFTWARE SUB MONTHLY", "SAN JOSE CA", 2999, []), ("12/14/26", "ACME SUPPLY CO", "AUSTIN TX", 31075, ["+15125550100"])]
PREV = 425010
SUM_PAY = sum(p[2] for p in PAY) + sum(c[3] for c in CRED); SUM_CHG = sum(c[3] for c in CHG); NEW = PREV + SUM_PAY + SUM_CHG
c = canvas.Canvas(os.path.join(HERE, "stmt-card.pdf"), pagesize=letter); W, H = letter
def T(x, y, s, size=9, bold=False, right=False):
    c.setFont("Helvetica-Bold" if bold else "Helvetica", size); (c.drawRightString if right else c.drawString)(x, y, s)
T(50, 750, "Summit Business Card", 13, True); T(50, 736, "ACME TEST LLC"); T(50, 724, "Closing Date 12/15/26   Next Closing Date 01/15/27"); T(50, 712, "Account Ending 4-77123")
T(50, 680, "New Balance", 12, True); T(300, 680, M(NEW), 12, True, True); T(50, 664, "Minimum Payment Due", 12, True); T(300, 664, "$35.00", 12, True, True)
T(50, 620, "If you do not pay the Minimum Payment Due by the Payment Due Date of 01/10/27, you may have to pay a late fee.")
T(340, 620, "Account Summary", 11, True)
y = 600; T(50, y, "If you would like information about credit counseling, call 1-800-555-0100."); T(340, y, "Pay In Full Portion", 9, True)
for lab, v in [("Previous Balance", 1250), ("Payments/Credits", -1250), ("New Charges", 1500), ("New Balance", 1500)]:
    y -= 12; T(340, y, lab); T(560, y, M(v) if v >= 0 else M(v), 9, False, True)
y -= 20; T(340, y, "Pay Over Time Portion", 9, True)
for lab, v in [("Previous Balance", PREV - 1250), ("Payments/Credits", SUM_PAY + 1250), ("New Charges", SUM_CHG - 1500), ("New Balance", NEW - 1500)]:
    y -= 12; T(340, y, lab); T(560, y, M(v), 9, False, True)
y -= 22; T(50, y, "See page 2 for important information about your account."); T(340, y, "Account Total", 9, True)
for lab, v in [("Previous Balance", PREV), ("Payments/Credits", SUM_PAY), ("New Charges", SUM_CHG), ("Fees", 0), ("Interest Charged", 0), ("New Balance", NEW), ("Minimum Payment Due", 3500)]:
    y -= 12; T(340, y, lab, 9, lab.startswith(("New B", "Prev"))); T(560, y, ("+" if lab == "New Charges" else "") + M(v), 9, False, True)
y -= 20; T(340, y, "Days in Billing Period: 30"); c.showPage()
y = 750
def row(d, desc, place, amt, extra, diamond=True):
    global y
    T(50, y, d); T(110, y, desc)
    if place: T(330, y, place.rsplit(" ", 1)[0]); T(450, y, place.rsplit(" ", 1)[1])
    T(560, y, M(amt), 9, False, True)
    if diamond: T(566, y, "*" if False else "♦") if False else None
    for e in extra: y -= 11; T(110, y, e)
    y -= 16
T(50, y, "Payments and Credits", 12, True); y -= 18; T(50, y, "Payments", 9, True); T(560, y, "Amount", 9, True, True); y -= 16
for d, desc, a in PAY: row(d, desc, "", a, [], False)
T(50, y, "Credits", 9, True); y -= 16
for d, desc, place, a, ex in CRED: row(d, desc, place, a, ex)
y -= 6; T(50, y, "New Charges", 12, True); y -= 18; T(50, y, "Detail", 9, True); T(560, y, "Amount", 9, True, True); y -= 16
for d, desc, place, a, ex in CHG: row(d, desc, place, a, ex)
y -= 6; T(50, y, "Total Fees for this Period"); T(560, y, "$0.00", 9, False, True); y -= 14; T(50, y, "Total Interest Charged for this Period"); T(560, y, "$0.00", 9, False, True)
c.save()
# QuickBooks Transaction Report in the same shape QuickBooks exports (title rows, blank first column, Amount + Debit/Credit columns, totals). Dates are posting dates (1 day after the statement's).
import csv, datetime as dt
def post(d): return (dt.datetime.strptime(d.rstrip("*"), "%m/%d/%y") + dt.timedelta(days=1)).strftime("%m/%d/%Y")
rows = [["Acme Test LLC"] + [""] * 11, ["Transaction Report"] + [""] * 11, ["November 16-December 15, 2026"] + [""] * 11, [""] * 12,
        ["", "Transaction date", "Transaction type", "Num", "Name", "Description", "Account Name", "Item split account", "Amount", "Balance", "Debit", "Credit"],
        ["Summit Business Card (7123)"] + [""] * 11, ["", "Beginning Balance"] + [""] * 7 + [f"{PREV/100:,.2f}", "", ""]]
bal = PREV; acct = "Summit Business Card (7123)"
items = [(d, t, n, desc, a) for d, desc, a in PAY for t, n in [("Credit Card Payment", "")]] + [(d, "Credit Card Credit", "", desc, a) for d, desc, p, a, e in CRED] + [(d, "Expense", "", desc, a) for d, desc, p, a, e in CHG]
items.append(("12/12/26", "Expense", "", "BANK SERVICE FEE", 500))  # in QuickBooks only
for d, t, n, desc, a in sorted(items, key=lambda x: post(x[0]) if x[0] != "12/12/26" else "12/12/2026"):
    bal += a; dd = post(d) if d != "12/12/26" else "12/12/2026"
    rows.append(["", dd, t, "", n, desc, acct, "Software & apps", f"{a/100:,.2f}", f"{bal/100:,.2f}", f"{-a/100:,.2f}" if a < 0 else "", f"{a/100:,.2f}" if a > 0 else ""])
tot = sum(i[4] for i in items); deb = -sum(i[4] for i in items if i[4] < 0); cre = sum(i[4] for i in items if i[4] > 0)
rows += [[f"Total for {acct}"] + [""] * 7 + [f"-${-tot/100:,.2f}" if tot < 0 else f"${tot/100:,.2f}", "", f"${deb/100:,.2f}", f"${cre/100:,.2f}"],
         ["TOTAL"] + [""] * 7 + [f"-${-tot/100:,.2f}" if tot < 0 else f"${tot/100:,.2f}", "", f"${deb/100:,.2f}", f"${cre/100:,.2f}"], [""] * 12, ['Accrual Basis Saturday, December 19, 2026 09:00 AM GMT-08:00'] + [""] * 11]
with open(os.path.join(HERE, "qbo-card.csv"), "w", newline="") as f: csv.writer(f).writerows(rows)
print("new balance", NEW, "sum", SUM_PAY + SUM_CHG)
