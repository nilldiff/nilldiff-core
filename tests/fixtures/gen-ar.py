"""Makes a synthetic customer AR statement (invented invoices; every page says TEST FIXTURE): a table with a header row, right-aligned amounts,
the header repeated on page two, and a total line. Run: python3 tests/fixtures/gen-ar.py"""
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
import os
HERE = os.path.dirname(os.path.abspath(__file__))
ROWS = [("INV-20409", "2026-10-28", "2026-11-27", "2600.00", "2600.00"), ("INV-20407", "2026-10-20", "2026-11-15", "9875.00", "9875.00"),
        ("INV-20401", "2026-09-05", "2026-10-05", "12450.00", "12450.00"), ("INV-20402", "2026-09-12", "2026-10-12", "8200.00", "8199.60"),
        ("INV-20403", "2026-09-18", "2026-10-18", "15780.50", "10780.50"), ("INV-20404", "2026-09-25", "2026-10-25", "3954.00", "3954.00"),
        ("INV-20405", "2026-10-02", "2026-11-02", "22000.00", "22000.00"), ("INV-20406", "2026-10-09", "2026-11-08", "6310.25", "6310.25")]
c = canvas.Canvas(os.path.join(HERE, "ar-statement.pdf"), pagesize=letter)
def head(y):
    c.setFont("Helvetica-Bold", 9)
    for x, s, r in [(40, "Invoice", 0), (150, "Date", 0), (230, "Due", 0), (380, "Charges", 1), (470, "Balance", 1)]: (c.drawRightString if r else c.drawString)(x, y, s)
def page(rows, total=None):
    c.setFont("Helvetica", 7); c.drawString(400, 770, "TEST FIXTURE - NOT A REAL STATEMENT")
    c.setFont("Helvetica-Bold", 12); c.drawString(40, 740, "Customer Statement - Example Co (invented)"); head(700); y = 684
    c.setFont("Helvetica", 9)
    for r in rows:
        c.drawString(40, y, r[0]); c.drawString(150, y, r[1]); c.drawString(230, y, r[2]); c.drawRightString(380, y, f"{float(r[3]):,.2f}"); c.drawRightString(470, y, f"{float(r[4]):,.2f}"); y -= 14
    if total: c.setFont("Helvetica-Bold", 9); c.drawString(40, y - 6, "Total"); c.drawRightString(470, y - 6, total)
    c.showPage()
page(ROWS[:4]); page(ROWS[4:], f"{sum(float(r[4]) for r in ROWS):,.2f}"); c.save()
