//TEST VERSION: paste into a copy of a sheet (Extensions > Apps Script), then run setUp once as ucscbesa@ucsc.edu.
//Logs every edit to a locked, hidden tab, to find out whether Google names the editor and whether the tab really locks.
//It records the name from both places Google might give it, so the test shows which one works.
const LOG_TAB = "Edit Log"
const HEADERS = ["Time", "e.user", "Active user", "Script ran as", "What", "Tab", "Cells", "Old value", "New value"]
const VALUE_MAX_LENGTH = 2000
//OTHER covers things like unhiding a tab, and FORMAT is colors and the like, so neither is work on the data
const IGNORED_CHANGES = ["EDIT", "OTHER", "FORMAT"]

function setUp() {
    const spreadsheet = SpreadsheetApp.getActive()
    const log = spreadsheet.getSheetByName(LOG_TAB) || spreadsheet.insertSheet(LOG_TAB)
    log.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight("bold")
    log.setFrozenRows(1)
    log.hideSheet()

    //only the account running this can change the tab
    const protection = log.protect().setDescription("Edit log")
    protection.removeEditors(protection.getEditors())
    if (protection.canDomainEdit()) protection.setDomainEdit(false)

    //run setUp twice and there's still only one of each
    ScriptApp.getProjectTriggers().forEach(trigger => ScriptApp.deleteTrigger(trigger))
    ScriptApp.newTrigger("logEdit").forSpreadsheet(spreadsheet).onEdit().create()
    ScriptApp.newTrigger("logChange").forSpreadsheet(spreadsheet).onChange().create()
}

//the leading ' keeps a typed formula as plain text, so someone's cell can't run inside the log
function asText(value) {
    return "'" + String(value === undefined ? "" : value).slice(0, VALUE_MAX_LENGTH)
}

function userEmail(e) {
    return e.user ? e.user.getEmail() : ""
}

function addRow(e, what, tab, cells, oldValue, newValue) {
    SpreadsheetApp.getActive().getSheetByName(LOG_TAB).appendRow([
        new Date().toISOString(), userEmail(e), Session.getActiveUser().getEmail(), Session.getEffectiveUser().getEmail(),
        what, asText(tab), cells, asText(oldValue), asText(newValue),
    ])
}

function logEdit(e) {
    const tab = e.range.getSheet().getName()
    if (tab === LOG_TAB) return
    const oneCell = e.range.getNumRows() === 1 && e.range.getNumColumns() === 1
    //Google only gives the old and new values for a single cell, so a paste records what's there now
    addRow(e, oneCell ? "edit" : "multi-cell edit", tab, e.range.getA1Notation(), e.oldValue, oneCell ? e.value : JSON.stringify(e.range.getDisplayValues()))
}

//rows and columns being added or removed don't count as edits
function logChange(e) {
    if (IGNORED_CHANGES.includes(e.changeType)) return
    addRow(e, e.changeType, e.source.getActiveSheet().getName(), "", "", "")
}
