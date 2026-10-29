"""Build report/report.html from README.md, then print it to REPORT.pdf with headless Chrome.

Run:  py report/build_report.py
"""
import subprocess
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parent.parent
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

md = (ROOT / "README.md").read_text(encoding="utf-8")
md = md.replace("![Dashboard overview](screenshots/01_dashboard_full_2025.png)\n", "", 1)  # cover image: README only
md = md.replace("](screenshots/", "](../screenshots/")
body = markdown.markdown(md, extensions=["tables", "fenced_code"])
# each screenshot sub-section (8.x) starts on a fresh page: heading + caption + image together
body = body.replace("<h3>8.", '<h3 class="shot">8.')

CSS = """
@page { size: A4; margin: 16mm 14mm; }
body { font-family: "Segoe UI", system-ui, sans-serif; font-size: 10.5pt; line-height: 1.5; color: #1b1b1b; }
h1 { font-size: 22pt; margin: 0 0 4pt; color: #184f95; }
h2 { font-size: 14pt; color: #184f95; border-bottom: 1.5px solid #cde2fb; padding-bottom: 3pt; margin-top: 18pt; page-break-after: avoid; }
h3 { font-size: 11.5pt; margin: 12pt 0 4pt; page-break-after: avoid; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 9pt; page-break-inside: auto; }
tr { page-break-inside: avoid; }
th, td { border: 1px solid #d5d4ce; padding: 3pt 6pt; text-align: left; vertical-align: top; }
th { background: #eef4fc; }
code { font-family: Consolas, monospace; font-size: 8.8pt; background: #f3f3f1; padding: 0 2pt; border-radius: 2pt; }
pre { background: #f6f6f4; border: 1px solid #e1e0d9; border-radius: 4pt; padding: 7pt 9pt; white-space: pre-wrap; word-break: break-word; page-break-inside: avoid; }
pre code { background: none; padding: 0; font-size: 8.3pt; }
img { max-width: 100%; max-height: 222mm; width: auto; border: 1px solid #ccc; border-radius: 4pt; display: block; margin: 6pt auto 12pt; }
p:has(> img) { page-break-inside: avoid; }
blockquote { margin: 6pt 0; padding: 6pt 10pt; background: #fff7e6; border-left: 3pt solid #c98500; }
blockquote p { margin: 0; }
hr { border: none; border-top: 1px solid #ddd; }
a { color: #1c5cab; }
h3.shot { page-break-before: always; }
"""
html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Retail Sales KPI Dashboard - Project Report</title>
<style>{CSS}</style></head><body>{body}</body></html>"""
out = ROOT / "report" / "report.html"
out.write_text(html, encoding="utf-8")
print("wrote", out)

pdf = ROOT / "REPORT.pdf"
subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                f"--print-to-pdf={pdf}", "--virtual-time-budget=5000", out.as_uri()], check=True)
print("wrote", pdf)
