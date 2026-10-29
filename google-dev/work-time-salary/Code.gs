/**
 * Work Time & Salary Tracker
 * Container-bound Apps Script for a Google Sheet.
 * Menu: Work Tracker -> Set up sheets / Generate Google Doc report / Export report as Word (.docx)
 *
 * Time Log columns: A Date, B Employee, C Start, D End, E Break (min),
 *                   F Hours, G Overtime hrs, H Pay (formulas)
 */

var LOG_SHEET = 'Time Log';
var SETTINGS_SHEET = 'Settings';
var EMPLOYEES_SHEET = 'Employees';
var LOG_ROWS = 1000;
var EMP_ROWS = 199;

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Work Tracker')
    .addItem('Set up sheets', 'setupSheets')
    .addSeparator()
    .addItem('Generate Google Doc report (all employees)', 'generateReport')
    .addItem('Export report as Word (.docx)', 'exportReportAsDocx')
    .addToUi();
}

/** Menu entry: sets up the sheets and tells the user. */
function setupSheets() {
  ensureSheets_();
  SpreadsheetApp.getUi().alert(
    'Sheets are ready.\n\nAdd your team on "Employees", set pay rules on "Settings", ' +
    'then log shifts on "Time Log" (or use the web app).');
}

/** Creates the Settings, Employees and Time Log sheets with formulas. Safe to re-run. */
function ensureSheets_() {
  var ss = SpreadsheetApp.getActive();

  var settings = ss.getSheetByName(SETTINGS_SHEET) || ss.insertSheet(SETTINGS_SHEET);
  if (settings.getRange('A1').getValue() === '') {
    settings.getRange('A1:B4').setValues([
      ['Default hourly rate (KRW)', 10000],
      ['Overtime after (hours per shift)', 8],
      ['Overtime multiplier', 1.5],
      ['Currency symbol', '₩']
    ]);
    settings.getRange('A1:A4').setFontWeight('bold');
    settings.setColumnWidth(1, 240);
  } else if (settings.getRange('A1').getValue().indexOf('KRW') < 0) {
    // Settings from the dollar versions: switch to Korean won and fix the overtime label.
    settings.getRange('A1').setValue('Default hourly rate (KRW)');
    settings.getRange('A2').setValue('Overtime after (hours per shift)');
    if (settings.getRange('B1').getValue() === 20) settings.getRange('B1').setValue(10000);
    if (settings.getRange('B4').getValue() === '$') settings.getRange('B4').setValue('₩');
  }

  var emps = ss.getSheetByName(EMPLOYEES_SHEET) || ss.insertSheet(EMPLOYEES_SHEET);
  emps.getRange('A1:B1')
    .setValues([['Employee', 'Hourly rate (blank = default)']])
    .setFontWeight('bold')
    .setBackground('#1a73e8')
    .setFontColor('#ffffff');
  emps.setFrozenRows(1);
  emps.setColumnWidth(1, 200);
  emps.setColumnWidth(2, 230);

  var log = ss.getSheetByName(LOG_SHEET) || ss.insertSheet(LOG_SHEET, 0);
  // Upgrade the first version of the log (no Employee column).
  if (log.getRange('B1').getValue() === 'Start') log.insertColumnAfter(1);

  log.getRange('A1:H1')
    .setValues([['Date', 'Employee', 'Start', 'End', 'Break (min)', 'Hours', 'Overtime hrs', 'Pay']])
    .setFontWeight('bold')
    .setBackground('#1a73e8')
    .setFontColor('#ffffff');
  log.setFrozenRows(1);

  var rate = 'IF(N(IFERROR(VLOOKUP(B#,Employees!$A$2:$B$200,2,FALSE),0))>0,' +
    'VLOOKUP(B#,Employees!$A$2:$B$200,2,FALSE),Settings!$B$1)';
  var formulas = [];
  for (var r = 2; r <= LOG_ROWS + 1; r++) {
    formulas.push([
      '=IF(D' + r + '="","",ROUND(MOD(D' + r + '-C' + r + ',1)*24-N(E' + r + ')/60,2))',
      '=IF(F' + r + '="","",MAX(0,F' + r + '-Settings!$B$2))',
      '=IF(F' + r + '="","",LET(rt,' + rate.replace(/#/g, r) + ',ROUND((F' + r + '-G' + r +
        ')*rt+G' + r + '*rt*Settings!$B$3,0)))'
    ]);
  }
  log.getRange(2, 6, LOG_ROWS, 3).setFormulas(formulas);
  log.getRange(2, 1, LOG_ROWS, 1).setNumberFormat('yyyy-mm-dd');
  log.getRange(2, 2, LOG_ROWS, 1).setNumberFormat('@');
  log.getRange(2, 3, LOG_ROWS, 2).setNumberFormat('HH:mm');
  log.getRange(2, 6, LOG_ROWS, 2).setNumberFormat('0.00');
  log.getRange(2, 8, LOG_ROWS, 1).setNumberFormat('#,##0');
  log.getRange(2, 2, LOG_ROWS, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInRange(emps.getRange('A2:A200'), true)
      .setAllowInvalid(true)
      .build());
  log.autoResizeColumns(1, 8);
  ss.setActiveSheet(log);
}

/**
 * Reads the log for a month. employee '' / undefined = everyone.
 * Returns { rows, totals, byEmployee, symbol }.
 */
function collectMonth_(year, month, employee) {
  var ss = SpreadsheetApp.getActive();
  var log = ss.getSheetByName(LOG_SHEET);
  var settings = ss.getSheetByName(SETTINGS_SHEET);
  if (!log || !settings) throw new Error('Run "Set up sheets" first.');
  var symbol = String(settings.getRange('B4').getValue() || '');

  var range = log.getRange(2, 1, LOG_ROWS, 8);
  var data = range.getValues();
  var shown = range.getDisplayValues();
  var rows = [];
  var totals = { hours: 0, overtime: 0, pay: 0 };
  var per = {};

  // The date comes from the displayed text (yyyy-mm-dd) so time zones can't shift the month.
  data.forEach(function (row, i) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(shown[i][0]);
    if (!m || row[5] === '') return;
    if (+m[1] !== year || +m[2] - 1 !== month) return;
    var name = String(row[1]);
    if (employee && name !== employee) return;
    rows.push({
      row: i + 2,
      date: new Date(+m[1], +m[2] - 1, +m[3], 12),
      dateText: shown[i][0],
      employee: name,
      start: shown[i][2],
      end: shown[i][3],
      brk: row[4] === '' ? 0 : row[4],
      hours: row[5],
      overtime: row[6],
      pay: row[7]
    });
    totals.hours += row[5];
    totals.overtime += row[6];
    totals.pay += row[7];
    var p = per[name] || (per[name] = { name: name, shifts: 0, hours: 0, overtime: 0, pay: 0 });
    p.shifts += 1;
    p.hours += row[5];
    p.overtime += row[6];
    p.pay += row[7];
  });

  rows.sort(function (a, b) { return a.date - b.date || (a.employee < b.employee ? -1 : 1); });
  var byEmployee = Object.keys(per).sort().map(function (k) { return per[k]; });
  return { rows: rows, totals: totals, byEmployee: byEmployee, symbol: symbol };
}

/** Prompts for a month (yyyy-MM, blank = current) and returns [year, monthIndex]. */
function askMonth_() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt('Report month', 'Enter month as yyyy-MM (leave blank for current month):',
    ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return null;
  var text = resp.getResponseText().trim();
  if (!text) {
    var now = new Date();
    return [now.getFullYear(), now.getMonth()];
  }
  var m = /^(\d{4})-(\d{2})$/.exec(text);
  if (!m || +m[2] < 1 || +m[2] > 12) {
    ui.alert('Invalid month. Use yyyy-MM, e.g. 2026-10.');
    return null;
  }
  return [+m[1], +m[2] - 1];
}

/**
 * Builds a Google Doc with summary, chart and tables. employee '' = everyone.
 * Returns the Doc.
 */
function buildReportDoc_(year, month, employee) {
  var result = collectMonth_(year, month, employee);
  if (!result.rows.length) throw new Error('No completed entries found for that month.');

  var tz = Session.getScriptTimeZone();
  var monthLabel = Utilities.formatDate(new Date(year, month, 1), tz, 'MMMM yyyy');
  var who = employee || 'All employees';
  // Korean won has no minor unit: whole numbers with thousands separators.
  var money = function (n) {
    return result.symbol + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };
  var HEAD = DocumentApp.ParagraphHeading;

  var doc = DocumentApp.create('Work Report - ' + who + ' - ' + monthLabel);
  var body = doc.getBody();

  body.appendParagraph('Work Time & Salary Report').setHeading(HEAD.TITLE);
  body.appendParagraph(who + ' - ' + monthLabel).setHeading(HEAD.SUBTITLE);

  body.appendParagraph('Summary').setHeading(HEAD.HEADING1);
  body.appendTable([
    ['Shifts logged', String(result.rows.length)],
    ['Total hours', result.totals.hours.toFixed(2)],
    ['Overtime hours', result.totals.overtime.toFixed(2)],
    ['Average hours/shift', (result.totals.hours / result.rows.length).toFixed(2)],
    ['Total salary', money(result.totals.pay)]
  ]);

  if (!employee) {
    body.appendParagraph('By employee').setHeading(HEAD.HEADING1);
    var team = [['Employee', 'Shifts', 'Hours', 'Overtime', 'Pay']];
    result.byEmployee.forEach(function (p) {
      team.push([p.name || '(none)', String(p.shifts), p.hours.toFixed(2), p.overtime.toFixed(2),
        money(p.pay)]);
    });
    var tt = body.appendTable(team);
    tt.getRow(0).editAsText().setBold(true);
  }

  var chartData = Charts.newDataTable().addColumn(Charts.ColumnType.STRING, 'Label')
    .addColumn(Charts.ColumnType.NUMBER, 'Hours');
  var chartTitle;
  if (employee) {
    chartTitle = 'Hours per day - ' + employee;
    result.rows.forEach(function (r) {
      chartData.addRow([Utilities.formatDate(r.date, tz, 'd MMM'), r.hours]);
    });
  } else {
    chartTitle = 'Hours per employee - ' + monthLabel;
    result.byEmployee.forEach(function (p) { chartData.addRow([p.name || '(none)', p.hours]); });
  }
  body.appendParagraph('Hours').setHeading(HEAD.HEADING1);
  var chart = Charts.newColumnChart()
    .setDataTable(chartData.build())
    .setTitle(chartTitle)
    .setColors(['#1a73e8'])
    .setLegendPosition(Charts.Position.NONE)
    .setDimensions(600, 320)
    .build();
  body.appendImage(chart.getAs('image/png'));

  body.appendParagraph('Daily breakdown').setHeading(HEAD.HEADING1);
  var header = employee ? ['Date', 'Hours', 'Overtime', 'Pay'] : ['Date', 'Employee', 'Hours', 'Overtime', 'Pay'];
  var table = [header];
  result.rows.forEach(function (r) {
    var cells = [Utilities.formatDate(r.date, tz, 'EEE, d MMM yyyy')];
    if (!employee) cells.push(r.employee);
    cells.push(r.hours.toFixed(2), r.overtime.toFixed(2), money(r.pay));
    table.push(cells);
  });
  var total = ['Total'];
  if (!employee) total.push('');
  total.push(result.totals.hours.toFixed(2), result.totals.overtime.toFixed(2), money(result.totals.pay));
  table.push(total);
  var t = body.appendTable(table);
  t.getRow(0).editAsText().setBold(true);
  t.getRow(table.length - 1).editAsText().setBold(true);

  doc.saveAndClose();
  return doc;
}

function generateReport() {
  var ym = askMonth_();
  if (!ym) return;
  try {
    var doc = buildReportDoc_(ym[0], ym[1], '');
    SpreadsheetApp.getUi().alert('Report created:\n' + doc.getUrl());
  } catch (e) {
    SpreadsheetApp.getUi().alert(e.message);
  }
}

/** Saves a Word (.docx) copy of a Google Doc in the Drive root and returns the file. */
function saveAsDocx_(doc) {
  var url = 'https://docs.google.com/document/d/' + doc.getId() + '/export?format=docx';
  var blob = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
  }).getBlob().setName(doc.getName() + '.docx');
  return DriveApp.createFile(blob);
}

/** Builds the report and saves a Word (.docx) copy in the Drive root. */
function exportReportAsDocx() {
  var ym = askMonth_();
  if (!ym) return;
  var ui = SpreadsheetApp.getUi();
  try {
    var doc = buildReportDoc_(ym[0], ym[1], '');
    var file = saveAsDocx_(doc);
    ui.alert('Word file saved to Drive:\n' + file.getUrl() + '\n\nGoogle Doc:\n' + doc.getUrl());
  } catch (e) {
    ui.alert(e.message);
  }
}
