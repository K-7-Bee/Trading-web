/**
 * Work Time & Salary Tracker
 * Container-bound Apps Script for a Google Sheet.
 * Menu: Work Tracker -> Set up sheets / Generate Google Doc report / Export report as Word (.docx)
 */

var LOG_SHEET = 'Time Log';
var SETTINGS_SHEET = 'Settings';
var LOG_ROWS = 400;

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Work Tracker')
    .addItem('Set up sheets', 'setupSheets')
    .addSeparator()
    .addItem('Generate Google Doc report', 'generateReport')
    .addItem('Export report as Word (.docx)', 'exportReportAsDocx')
    .addToUi();
}

/** Creates the Settings and Time Log sheets with formulas. Safe to re-run. */
function setupSheets() {
  var ss = SpreadsheetApp.getActive();

  var settings = ss.getSheetByName(SETTINGS_SHEET) || ss.insertSheet(SETTINGS_SHEET);
  if (settings.getRange('A1').getValue() === '') {
    settings.getRange('A1:B4').setValues([
      ['Hourly rate', 20],
      ['Overtime after (hours/day)', 8],
      ['Overtime multiplier', 1.5],
      ['Currency symbol', '$']
    ]);
    settings.getRange('A1:A4').setFontWeight('bold');
    settings.setColumnWidth(1, 200);
  }

  var log = ss.getSheetByName(LOG_SHEET) || ss.insertSheet(LOG_SHEET, 0);
  log.getRange('A1:G1')
    .setValues([['Date', 'Start', 'End', 'Break (min)', 'Hours', 'Overtime hrs', 'Pay']])
    .setFontWeight('bold')
    .setBackground('#1a73e8')
    .setFontColor('#ffffff');
  log.setFrozenRows(1);

  var formulas = [];
  for (var r = 2; r <= LOG_ROWS + 1; r++) {
    formulas.push([
      '=IF(C' + r + '="","",ROUND(MOD(C' + r + '-B' + r + ',1)*24-N(D' + r + ')/60,2))',
      '=IF(E' + r + '="","",MAX(0,E' + r + '-Settings!$B$2))',
      '=IF(E' + r + '="","",ROUND((E' + r + '-F' + r + ')*Settings!$B$1+F' + r +
        '*Settings!$B$1*Settings!$B$3,2))'
    ]);
  }
  log.getRange(2, 5, LOG_ROWS, 3).setFormulas(formulas);
  log.getRange(2, 1, LOG_ROWS, 1).setNumberFormat('yyyy-mm-dd');
  log.getRange(2, 2, LOG_ROWS, 2).setNumberFormat('HH:mm');
  log.getRange(2, 5, LOG_ROWS, 3).setNumberFormat('0.00');
  log.autoResizeColumns(1, 7);
  ss.setActiveSheet(log);

  SpreadsheetApp.getUi().alert(
    'Sheets are ready.\n\nSet your hourly rate on "Settings", then log Date / Start / End / Break on "Time Log".');
}

/** Reads the log for a month and returns { rows, totals, symbol }. */
function collectMonth_(year, month) {
  var ss = SpreadsheetApp.getActive();
  var log = ss.getSheetByName(LOG_SHEET);
  var settings = ss.getSheetByName(SETTINGS_SHEET);
  if (!log || !settings) throw new Error('Run "Set up sheets" first.');

  var symbol = String(settings.getRange('B4').getValue() || '');
  var data = log.getRange(2, 1, LOG_ROWS, 7).getValues();
  var rows = [];
  var totals = { hours: 0, overtime: 0, pay: 0 };

  data.forEach(function (row) {
    var date = row[0];
    if (!(date instanceof Date) || row[4] === '') return;
    if (date.getFullYear() !== year || date.getMonth() !== month) return;
    rows.push({ date: date, hours: row[4], overtime: row[5], pay: row[6] });
    totals.hours += row[4];
    totals.overtime += row[5];
    totals.pay += row[6];
  });

  rows.sort(function (a, b) { return a.date - b.date; });
  return { rows: rows, totals: totals, symbol: symbol };
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

/** Builds a Google Doc with summary, daily table and a bar chart. Returns the Doc. */
function buildReportDoc_(year, month) {
  var result = collectMonth_(year, month);
  if (!result.rows.length) throw new Error('No completed entries found for that month.');

  var tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  var monthLabel = Utilities.formatDate(new Date(year, month, 1), tz, 'MMMM yyyy');
  var money = function (n) { return result.symbol + n.toFixed(2); };

  var doc = DocumentApp.create('Work Report - ' + monthLabel);
  var body = doc.getBody();

  body.appendParagraph('Work Time & Salary Report').setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph(monthLabel).setHeading(DocumentApp.ParagraphHeading.SUBTITLE);

  body.appendParagraph('Summary').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  var avg = result.totals.hours / result.rows.length;
  body.appendTable([
    ['Days worked', String(result.rows.length)],
    ['Total hours', result.totals.hours.toFixed(2)],
    ['Overtime hours', result.totals.overtime.toFixed(2)],
    ['Average hours/day', avg.toFixed(2)],
    ['Total salary', money(result.totals.pay)]
  ]);

  body.appendParagraph('Hours per day').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  var chartData = Charts.newDataTable()
    .addColumn(Charts.ColumnType.STRING, 'Day')
    .addColumn(Charts.ColumnType.NUMBER, 'Hours');
  result.rows.forEach(function (r) {
    chartData.addRow([Utilities.formatDate(r.date, tz, 'd MMM'), r.hours]);
  });
  var chart = Charts.newColumnChart()
    .setDataTable(chartData.build())
    .setTitle('Hours worked - ' + monthLabel)
    .setColors(['#1a73e8'])
    .setLegendPosition(Charts.Position.NONE)
    .setDimensions(600, 320)
    .build();
  body.appendImage(chart.getAs('image/png'));

  body.appendParagraph('Daily breakdown').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  var table = [['Date', 'Hours', 'Overtime', 'Pay']];
  result.rows.forEach(function (r) {
    table.push([
      Utilities.formatDate(r.date, tz, 'EEE, d MMM yyyy'),
      r.hours.toFixed(2),
      r.overtime.toFixed(2),
      money(r.pay)
    ]);
  });
  table.push(['Total', result.totals.hours.toFixed(2), result.totals.overtime.toFixed(2),
    money(result.totals.pay)]);
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
    var doc = buildReportDoc_(ym[0], ym[1]);
    SpreadsheetApp.getUi().alert('Report created:\n' + doc.getUrl());
  } catch (e) {
    SpreadsheetApp.getUi().alert(e.message);
  }
}

/** Builds the report and saves a Word (.docx) copy in the Drive root. */
function exportReportAsDocx() {
  var ym = askMonth_();
  if (!ym) return;
  var ui = SpreadsheetApp.getUi();
  try {
    var doc = buildReportDoc_(ym[0], ym[1]);
    var url = 'https://docs.google.com/document/d/' + doc.getId() + '/export?format=docx';
    var blob = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
    }).getBlob().setName(doc.getName() + '.docx');
    var file = DriveApp.createFile(blob);
    ui.alert('Word file saved to Drive:\n' + file.getUrl() + '\n\nGoogle Doc:\n' + doc.getUrl());
  } catch (e) {
    ui.alert(e.message);
  }
}
