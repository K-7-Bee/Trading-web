/**
 * Web app entry point and server functions called from index.html
 * via google.script.run. Data lives in the bound Google Sheet.
 */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Work Tracker')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function sheets_() {
  var ss = SpreadsheetApp.getActive();
  var log0 = ss.getSheetByName(LOG_SHEET);
  var set0 = ss.getSheetByName(SETTINGS_SHEET);
  var stale = !log0 || !set0 || !ss.getSheetByName(EMPLOYEES_SHEET) ||
    log0.getRange('B1').getValue() !== 'Employee' ||
    log0.getRange('H2').getFormula().indexOf(',0)))') < 0 ||
    String(set0.getRange('A1').getValue()).indexOf('KRW') < 0;
  if (stale) ensureSheets_();
  return {
    log: ss.getSheetByName(LOG_SHEET),
    settings: ss.getSheetByName(SETTINGS_SHEET),
    employees: ss.getSheetByName(EMPLOYEES_SHEET)
  };
}

function readSettings_() {
  var v = sheets_().settings.getRange('B1:B4').getValues();
  return { rate: v[0][0], overtimeAfter: v[1][0], multiplier: v[2][0], symbol: String(v[3][0]) };
}

function listEmployees_() {
  var vals = sheets_().employees.getRange(2, 1, EMP_ROWS, 2).getValues();
  var out = [];
  vals.forEach(function (v, i) {
    var name = String(v[0]).trim();
    if (name) out.push({ name: name, rate: v[1] === '' ? null : v[1], row: i + 2 });
  });
  return out;
}

/** Initial payload for the page. */
function getInit() {
  var now = new Date();
  var tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  return {
    settings: readSettings_(),
    employees: listEmployees_(),
    today: Utilities.formatDate(now, tz, 'yyyy-MM-dd'),
    month: Utilities.formatDate(now, tz, 'yyyy-MM')
  };
}

function saveSettings(s) {
  var rate = Number(s.rate), after = Number(s.overtimeAfter), mult = Number(s.multiplier);
  if (!(rate >= 0) || !(after > 0 && after <= 24) || !(mult >= 1)) {
    throw new Error('Check the settings: rate >= 0, overtime after 1-24 hours, multiplier >= 1.');
  }
  var symbol = String(s.symbol || '').slice(0, 5);
  sheets_().settings.getRange('B1:B4').setValues([[rate], [after], [mult], [symbol]]);
  return readSettings_();
}

/** Adds an employee, or updates the rate if the name exists. Blank rate = default rate. */
function saveEmployee(name, rate) {
  name = String(name || '').trim();
  if (!name || name.length > 60) throw new Error('Enter a name (up to 60 characters).');
  if (/^[=+\-@]/.test(name)) throw new Error('A name cannot start with = + - or @.');
  var r = '';
  if (rate !== '' && rate !== null && rate !== undefined) {
    r = Number(rate);
    if (!(r >= 0)) throw new Error('Hourly rate must be 0 or more (or blank for the default).');
  }
  var sh = sheets_().employees;
  var existing = listEmployees_();
  var match = existing.filter(function (e) { return e.name.toLowerCase() === name.toLowerCase(); })[0];
  if (match) {
    sh.getRange(match.row, 2).setValue(r);
  } else {
    var used = {};
    existing.forEach(function (e) { used[e.row] = true; });
    var row = -1;
    for (var i = 2; i <= EMP_ROWS + 1; i++) { if (!used[i]) { row = i; break; } }
    if (row < 0) throw new Error('Employee list is full.');
    sh.getRange(row, 1, 1, 2).setValues([[name, r]]);
  }
  return listEmployees_();
}

/** Removes an employee from the list. Their logged shifts stay in the Time Log. */
function deleteEmployee(name) {
  var match = listEmployees_().filter(function (e) { return e.name === name; })[0];
  if (!match) throw new Error('Employee not found.');
  sheets_().employees.getRange(match.row, 1, 1, 2).clearContent();
  return listEmployees_();
}

/** Returns the month's rows and totals as plain JSON. month is 'yyyy-MM'. */
function getMonth(month, employee) {
  var m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error('Bad month.');
  sheets_();
  var r = collectMonth_(+m[1], +m[2] - 1, employee || '');
  return {
    symbol: r.symbol,
    totals: r.totals,
    byEmployee: r.byEmployee,
    rows: r.rows.map(function (x) {
      return {
        row: x.row, date: x.dateText, employee: x.employee, start: x.start, end: x.end,
        brk: x.brk, hours: x.hours, overtime: x.overtime, pay: x.pay
      };
    })
  };
}

/** Validates a shift from the page and returns the break as a number. */
function checkEntry_(e) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) throw new Error('Pick a date.');
  if (!/^\d{2}:\d{2}$/.test(e.start) || !/^\d{2}:\d{2}$/.test(e.end)) {
    throw new Error('Enter a start and end time.');
  }
  var brk = Number(e.brk || 0);
  if (!(brk >= 0 && brk < 1440)) throw new Error('Break must be in minutes.');
  var known = listEmployees_().some(function (x) { return x.name === e.employee; });
  if (!known) throw new Error('Pick an employee (add them under Team first).');
  return brk;
}

/** Changes an existing shift. Restores the old values if the new ones give no hours. */
function updateEntry(row, e) {
  row = Number(row);
  if (!(row >= 2 && row <= LOG_ROWS + 1)) throw new Error('Bad row.');
  var brk = checkEntry_(e);
  var log = sheets_().log;
  var cells = log.getRange(row, 1, 1, 5);
  var prev = cells.getDisplayValues();
  if (prev[0][0] === '') throw new Error('That shift no longer exists. Refresh the page.');

  cells.setValues([[e.date, e.employee, e.start, e.end, brk]]);
  SpreadsheetApp.flush();
  var hours = log.getRange(row, 6).getValue();
  if (hours !== '' && hours <= 0) {
    cells.setValues(prev);
    throw new Error('Break is longer than the shift.');
  }
  return true;
}

function addEntry(e) {
  var brk = checkEntry_(e);

  var log = sheets_().log;
  var dates = log.getRange(2, 1, LOG_ROWS, 1).getValues();
  var idx = -1;
  for (var i = 0; i < dates.length; i++) {
    if (dates[i][0] === '') { idx = i; break; }
  }
  if (idx < 0) throw new Error('The Time Log is full (' + LOG_ROWS + ' rows).');

  // Strings are parsed by Sheets using the column formats, so time zones can't shift them.
  log.getRange(idx + 2, 1, 1, 5).setValues([[e.date, e.employee, e.start, e.end, brk]]);
  SpreadsheetApp.flush();
  var hours = log.getRange(idx + 2, 6).getValue();
  if (hours !== '' && hours <= 0) {
    log.getRange(idx + 2, 1, 1, 5).clearContent();
    throw new Error('Break is longer than the shift.');
  }
  return true;
}

/** Clears the input cells of a row; the formula cells stay. */
function deleteEntry(row) {
  row = Number(row);
  if (!(row >= 2 && row <= LOG_ROWS + 1)) throw new Error('Bad row.');
  sheets_().log.getRange(row, 1, 1, 5).clearContent();
  return true;
}

function createReport(month, employee, asDocx) {
  var m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error('Bad month.');
  sheets_();
  var doc = buildReportDoc_(+m[1], +m[2] - 1, employee || '');
  var out = { docUrl: doc.getUrl() };
  if (asDocx) out.docxUrl = saveAsDocx_(doc).getUrl();
  return out;
}
