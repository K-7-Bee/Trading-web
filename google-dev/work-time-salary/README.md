# Work Tracker (Google Apps Script web app)

Track work hours and pay for a team, in Korean won. Data lives in a Google Sheet; the
interface is a web app. Reports are created as Google Docs and can be saved as Word (.docx).

## What it does
- Manage a team, each person with their own hourly rate (blank = default rate).
- Log, edit and delete shifts. Times accept `9`, `930`, `9:30`, `18` or `6pm`; shift presets fill start, end and break.
- Month calendar shaded by hours worked, with overtime marked. Pick a person to see only their days.
- Pay is calculated per shift: hours beyond the overtime limit are paid at the multiplier.
- Google Doc or Word report for the selected person (or everyone) and month, with a chart.
- Works on phones and in dark mode.

## Files
| File | Purpose |
| --- | --- |
| `Code.gs` | Sheet setup, month data, report builder, spreadsheet menu |
| `WebApp.gs` | Web app entry point and functions called by the page |
| `index.html` | The interface |
| `appsscript.json` | Manifest: permissions and web app access |

## Deploy with clasp
```
npm i -g @google/clasp
clasp login                      # also turn on the Apps Script API at script.google.com/home/usersettings
cd google-dev/work-time-salary
clasp create --type sheets --title "Work Tracker" --rootDir .
git checkout -- appsscript.json  # clasp create replaces the manifest; restore this one
clasp push -f
clasp create-deployment --description "v1"
```
Open the URL it prints as `https://script.google.com/macros/s/<id>/exec`. To publish later changes to
the same URL, run `clasp push -f` then `clasp create-deployment --deploymentId <id>`.

The first visit asks for permission (Review permissions, Advanced, Go to Work Tracker, Allow).
The `Settings`, `Employees` and `Time Log` sheets are created automatically.

## Access
`appsscript.json` runs the app as the owner and lets anyone with the link in (`ANYONE_ANONYMOUS`, no
Google sign-in needed). Everyone reads and writes the same Sheet, and there is no login check, so only
share the link with people you trust. To restrict it, change `access` to `ANYONE` (Google account
required) or `MYSELF`. Redeploy a new version for the change to take effect.

## Notes
- Overtime is per shift, not per day: two 5-hour shifts on one day produce no overtime.
- Removing a person keeps their logged shifts; pay for those falls back to the default rate.
- `.clasp.json` holds the script ID and is not committed.
