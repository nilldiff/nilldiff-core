"""Makes synthetic statements in the layouts of several banks (invented numbers, invented customers and payees; every page says TEST FIXTURE).
Each one exercises a layout the parser has to read: sections and a checks-paid table, signed amounts and a daily-balance table,
unsigned amounts placed in columns under a two-line header, month-name dates with a posting date, and a single-line Debits/Credits/Balance header.
Run: python3 tests/fixtures/gen-banks.py"""
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
import os
HERE = os.path.dirname(os.path.abspath(__file__))
D = lambda c: f"{abs(c)/100:,.2f}"            # 1,234.56
S = lambda c: ("-" if c < 0 else "") + D(c)    # -1,234.56
U = lambda c: f"${D(c)}"                       # $1,234.56


class Pdf:
    def __init__(self, name):
        self.c = canvas.Canvas(os.path.join(HERE, name), pagesize=letter); self.y = 750; self.mark()
    def mark(self): self.t(400, 770, "TEST FIXTURE - NOT A REAL STATEMENT", 7)
    def t(self, x, y, s, size=9, bold=False, right=False):
        self.c.setFont("Helvetica-Bold" if bold else "Helvetica", size); (self.c.drawRightString if right else self.c.drawString)(x, y, s)
    def line(self, *parts, gap=14, size=9, bold=False):
        """parts: (x, text) or (x, text, 'r') for right-aligned"""
        for p in parts: self.t(p[0], self.y, p[1], size, bold, len(p) > 2)
        self.y -= gap
        if self.y < 60: self.c.showPage(); self.y = 750; self.mark()
    def save(self): self.c.save()


# 1. Sections, checks-paid table (number first), daily ending balance table, long-form period
p = Pdf("bank-chase.pdf"); BEGIN = 800000
dep = [("10/02", "Remote Online Deposit 1", 245000), ("10/16", "Orig CO Name:Stripe Payouts Orig ID:1800948598", 138025)]
chk = [("1047", "^", "10/07", 60000), ("1048", "", "10/21", 12999)]
ele = [("10/09", "Orig CO Name:Gusto Payroll", 321040), ("10/23", "Card Purchase 10/22 Office Depot #1123 Irvine CA", 8417)]
fee = [("10/31", "Monthly Service Fee", 1500)]
END = BEGIN + sum(a for *_, a in dep) - sum(a for *_, a in chk) - sum(a for *_, a in ele) - sum(a for *_, a in fee)
p.line((50, "JPMorgan Chase Bank, N.A."), size=10, bold=True)
p.line((50, "October 01, 2026 through October 31, 2026"))
p.line((50, "Account Number: 000000918273645"))
p.line((50, "ORANGE GROVE TEST LLC"), gap=24)
p.line((50, "CHECKING SUMMARY  Chase Total Business Checking"), bold=True)
p.line((50, "Beginning Balance"), (400, U(BEGIN), "r"))
p.line((50, "Deposits and Additions"), (300, "2"), (400, U(sum(a for *_, a in dep)), "r"))
p.line((50, "Checks Paid"), (300, "2"), (400, "-" + U(sum(a for *_, a in chk)), "r"))
p.line((50, "Electronic Withdrawals"), (300, "2"), (400, "-" + U(sum(a for *_, a in ele)), "r"))
p.line((50, "Fees"), (300, "1"), (400, "-" + U(1500), "r"))
p.line((50, "Ending Balance"), (400, U(END), "r"), gap=24)
p.line((50, "DEPOSITS AND ADDITIONS"), bold=True); p.line((50, "DATE"), (100, "DESCRIPTION"), (540, "AMOUNT", "r"))
for d, desc, a in dep: p.line((50, d), (100, desc), (540, U(a), "r"))
p.line((50, "Total Deposits and Additions"), (540, U(sum(a for *_, a in dep)), "r"), gap=20)
p.line((50, "CHECKS PAID"), bold=True); p.line((50, "CHECK NO."), (130, "DESCRIPTION"), (380, "DATE PAID"), (540, "AMOUNT", "r"))
for n, img, d, a in chk: p.line((50, n), (80, img), (380, d), (540, U(a), "r"))
p.line((50, "Total Checks Paid"), (540, U(sum(a for *_, a in chk)), "r"), gap=20)
p.line((50, "ELECTRONIC WITHDRAWALS"), bold=True); p.line((50, "DATE"), (100, "DESCRIPTION"), (540, "AMOUNT", "r"))
for d, desc, a in ele: p.line((50, d), (100, desc), (540, U(a), "r"))
p.line((50, "Total Electronic Withdrawals"), (540, U(sum(a for *_, a in ele)), "r"), gap=20)
p.line((50, "FEES"), bold=True)
for d, desc, a in fee: p.line((50, d), (100, desc), (540, U(a), "r"))
p.line((50, "Total Fees"), (540, U(1500), "r"), gap=20)
p.line((50, "DAILY ENDING BALANCE"), bold=True); p.line((50, "DATE"), (150, "AMOUNT", "r"), (250, "DATE"), (350, "AMOUNT", "r"))
p.line((50, "10/02"), (150, U(BEGIN + 245000), "r"), (250, "10/07"), (350, U(BEGIN + 245000 - 60000), "r"))
p.line((50, "10/31"), (150, U(END), "r"))
p.line((50, "JPMorgan Chase Bank, N.A. Member FDIC"), size=7)
p.save()

# 2. Signed amounts with two-digit years, checks with the date first, grouped account number, ledger-balance table
p = Pdf("bank-bofa.pdf"); BEGIN = 1200000
dep = [("10/03/26", "WIRE TYPE:WIRE IN DATE: 261003 ORIG:NORTHWIND TRADERS", 410000)]
wd = [("10/06/26", "ONLINE BANKING TRANSFER TO CHK 9031", -120000), ("10/14/26", "CHECKCARD 1013 COSTCO WHSE #0478 TUSTIN CA", -21388)]
chk = [("10/12/26", "2051", -35000)]
fee = [("10/31/26", "Monthly Fee Business Adv Fundamentals", -1600)]
END = BEGIN + sum(a for *_, a in dep + wd + chk + fee)
p.line((50, "Bank of America"), size=12, bold=True)
p.line((50, "Your Business Advantage Fundamentals Banking"))
p.line((50, "for October 1, 2026 to October 31, 2026"), (360, "Account number: 3141 5926 5358"))
p.line((50, "CANYON TEST CO"), gap=24)
p.line((50, "Account summary"), bold=True)
p.line((50, "Beginning balance on October 1, 2026"), (400, U(BEGIN), "r"))
p.line((50, "Deposits and other credits"), (400, D(410000), "r"))
p.line((50, "Withdrawals and other debits"), (400, S(-141388), "r"))
p.line((50, "Checks"), (400, S(-35000), "r"))
p.line((50, "Service fees"), (400, S(-1600), "r"))
p.line((50, "Ending balance on October 31, 2026"), (400, U(END), "r"), gap=24)
p.line((50, "Deposits and other credits"), bold=True); p.line((50, "Date"), (110, "Description"), (540, "Amount", "r"))
for d, desc, a in dep: p.line((50, d), (110, desc), (540, S(a), "r"))
p.line((50, "Total deposits and other credits"), (540, U(410000), "r"), gap=20)
p.line((50, "Withdrawals and other debits"), bold=True); p.line((50, "Date"), (110, "Description"), (540, "Amount", "r"))
for d, desc, a in wd: p.line((50, d), (110, desc), (540, S(a), "r"))
p.line((50, "Total withdrawals and other debits"), (540, S(-141388), "r"), gap=20)
p.line((50, "Checks"), bold=True); p.line((50, "Date"), (110, "Check #"), (540, "Amount", "r"))
for d, n, a in chk: p.line((50, d), (110, n), (540, S(a), "r"))
p.line((50, "Total checks"), (540, S(-35000), "r"), gap=20)
p.line((50, "Service fees"), bold=True)
for d, desc, a in fee: p.line((50, d), (110, desc), (540, S(a), "r"))
p.line((50, "Daily ledger balances"), bold=True); p.line((50, "Date"), (150, "Balance ($)", "r"), (250, "Date"), (350, "Balance($)", "r"))
p.line((50, "10/03"), (150, D(BEGIN + 410000), "r"), (250, "10/06"), (350, D(BEGIN + 290000), "r"))
p.save()

# 3. Unsigned amounts in Deposits / Withdrawals columns under a two-line header; balance only on a day's last line; checks summary repeats the checks
p = Pdf("bank-wells.pdf"); BEGIN = 500000
rows = [("10/2", "", "Mobile Deposit : Ref Number :414151", 92500, 0), ("10/2", "", "Square Inc 261002 Sq Payout", 18010, 0),
        ("10/6", "", "Edison Co Bill Pay 261006", 0, 23145), ("10/14", "1205", "Check", 0, 41000), ("10/14", "", "Interest Payment", 112, 0),
        ("10/20", "1206", "Check", 0, 9550)]
p.line((50, "Wells Fargo Initiate Business Checking"), size=11, bold=True)
p.line((50, "October 31, 2026"), (500, "Page 1 of 1"))
p.line((50, "HARBOR TEST GROUP INC"))
p.line((50, "Account number: 7788990011"), gap=24)
END = BEGIN + sum(c - w for *_, c, w in rows)
p.line((50, "Activity summary"), bold=True)
p.line((50, "Beginning balance on 10/1"), (400, U(BEGIN), "r"))
p.line((50, "Deposits/Additions"), (400, D(sum(c for *_, c, w in rows)), "r"))
p.line((50, "Withdrawals/Subtractions"), (400, "- " + D(sum(w for *_, c, w in rows)), "r"))
p.line((50, "Ending balance on 10/31"), (400, U(END), "r"), gap=24)
p.line((50, "Transaction history"), bold=True)
p.line((300, "Deposits/"), (380, "Withdrawals/"), (470, "Ending daily"), gap=10)
p.line((50, "Date"), (85, "Number"), (130, "Description"), (350, "Additions", "r"), (440, "Subtractions", "r"), (530, "balance", "r"))
bal = BEGIN
for i, (d, n, desc, c, w) in enumerate(rows):
    bal += c - w; lastofday = i == len(rows) - 1 or rows[i + 1][0] != d
    p.line((50, d), (85, n), (130, desc), *([(350, D(c), "r")] if c else []), *([(440, D(w), "r")] if w else []), *([(530, D(bal), "r")] if lastofday else []))
p.line((50, "Ending balance on 10/31"), (530, D(END), "r"))
p.line((50, "Totals"), (350, U(sum(c for *_, c, w in rows)), "r"), (440, U(sum(w for *_, c, w in rows)), "r"), gap=20)
p.line((50, "Summary of checks written (checks listed are also displayed in the preceding Transaction history)"))
p.line((50, "Number"), (100, "Date"), (190, "Amount", "r"), (250, "Number"), (300, "Date"), (390, "Amount", "r"))
p.line((50, "1205"), (100, "10/14"), (190, D(41000), "r"), (250, "1206 *"), (300, "10/20"), (390, D(9550), "r"))
p.line((50, "Wells Fargo Bank, N.A. Member FDIC"), size=7)
p.save()

# 4. Card: month-name dates, transaction and posting date, payments as negatives, "Transactions" heading
p = Pdf("card-capone.pdf"); PREV = 120000
pay = [("Oct 3", "Oct 3", "CAPITAL ONE AUTOPAY PYMT", -50000)]
tx = [("Sep 25", "Sep 26", "BLUE BOTTLE COFFEE OAKLAND CA", 650), ("Sep 30", "Oct 1", "UNITED 0162345678901 HOUSTON TX", 48720),
      ("Oct 12", "Oct 13", "ZOOM.US 888-799-9666 CA", 1599), ("Oct 18", "Oct 19", "HOME DEPOT #6614 ANAHEIM CA", 23477)]
NEW = PREV + sum(a for *_, a in pay + tx)
p.line((50, "Capital One"), size=12, bold=True)
p.line((50, "Spark Cash Plus | Account ending in 4567"))
p.line((50, "Sep 22, 2026 - Oct 21, 2026  |  30 days in Billing Cycle"), gap=24)
p.line((50, "Payment Due Date"), (300, "Nov 15, 2026"))
p.line((50, "New Balance"), (300, U(NEW)))
p.line((50, "Minimum Payment Due"), (300, U(4000)), gap=24)
p.line((50, "Account Summary"), bold=True)
p.line((50, "Previous Balance"), (300, U(PREV)))
p.line((50, "Payments"), (300, "- " + U(50000)))
p.line((50, "Transactions"), (300, "+ " + U(sum(a for *_, a in tx))))
p.line((50, "New Balance"), (300, "= " + U(NEW)), gap=24)
p.line((50, "Payments, Credits and Adjustments"), bold=True)
p.line((50, "Trans Date"), (110, "Post Date"), (170, "Description"), (540, "Amount", "r"))
for t, q, desc, a in pay: p.line((50, t), (110, q), (170, desc), (540, "- " + U(a), "r"))
p.line((50, "Transactions"), bold=True)
p.line((50, "Trans Date"), (110, "Post Date"), (170, "Description"), (540, "Amount", "r"))
for t, q, desc, a in tx: p.line((50, t), (110, q), (170, desc), (540, U(a), "r"))
p.line((50, "Total Transactions for This Period"), (540, U(sum(a for *_, a in tx)), "r"))
p.save()

# 5. Savings: single-line Debits / Credits / Balance header, balance on every row, period without a start year
p = Pdf("bank-citi.pdf"); BEGIN = 2500000
rows = [("10/01", "TRANSFER FROM CHECKING 00012", 0, 100000), ("10/15", "TRANSFER TO CHECKING 00012", 40000, 0), ("10/31", "INTEREST PAID", 0, 1874)]
END = BEGIN + sum(c - d for _, _, d, c in rows)
p.line((50, "Citibank, N.A."), size=11, bold=True)
p.line((50, "Citi Savings"))
p.line((50, "Statement Period: Oct 1 - Oct 31, 2026"), (360, "Account 2468013579"), gap=24)
p.line((50, "Beginning Balance"), (400, U(BEGIN), "r"))
p.line((50, "Ending Balance"), (400, U(END), "r"), gap=24)
p.line((50, "Date"), (100, "Description"), (380, "Debits", "r"), (460, "Credits", "r"), (540, "Balance", "r"))
bal = BEGIN
for d, desc, dr, cr in rows:
    bal += cr - dr; p.line((50, d), (100, desc), *([(380, D(dr), "r")] if dr else []), *([(460, D(cr), "r")] if cr else []), (540, D(bal), "r"))
p.save()
print("ok")
