# Work Time & Salary Tracker (Google Apps Script)

A Google Sheets script that tracks work hours, calculates salary (with overtime), and
produces a Google Doc report with a summary, a bar chart and a daily table. The report can
also be saved as a Word (.docx) file in Google Drive.

## Install (no tools needed)
1. Create a new Google Sheet.
2. **Extensions -> Apps Script**, paste `Code.gs` over the default file.
3. Project Settings -> tick "Show appsscript.json" and paste in `appsscript.json`.
4. Reload the sheet. A **Work Tracker** menu appears.

## Install (clasp)
```
npm i -g @google/clasp
clasp login
clasp create --type sheets --title "Work Tracker" --rootDir .
clasp push
```

## Use
1. **Work Tracker -> Set up sheets** creates `Settings` and `Time Log`.
2. Edit `Settings`: hourly rate, overtime threshold (hours/day), overtime multiplier, currency.
3. On `Time Log` enter Date, Start, End, Break (min). Hours, overtime and pay fill in automatically.
4. **Generate Google Doc report** or **Export report as Word (.docx)**, then enter `yyyy-MM`
   (blank = current month).

Shifts that cross midnight are handled (End earlier than Start).
