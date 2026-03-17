// =====================================================
//  ALAS DE ALADO — Backend Google Apps Script
//  Pega este código completo en Apps Script
// =====================================================

const SHEET_NAME_REGISTROS = "Registros";
const SHEET_NAME_USUARIOS   = "Usuarios";
const SHEET_NAME_GRUPOS     = "Grupos";
const SHEET_NAME_INSUMOS    = "Insumos";

// ── Inicializar hojas si no existen ──────────────────
function inicializarHojas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  function getOrCreate(name, headers) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length)
        .setBackground("#D32F2F")
        .setFontColor("#ffffff")
        .setFontWeight("bold");
      sheet.setFrozenRows(1);
    }
    return sheet;
  }

  getOrCreate(SHEET_NAME_USUARIOS,   ["id","nombre","sucursal","area","username","password","role","activo"]);
  getOrCreate(SHEET_NAME_GRUPOS,     ["id","nombre","sucursal","imagen_url","activo"]);
  getOrCreate(SHEET_NAME_INSUMOS,    ["id","group_id","nombre","unidad","ubicacion","instrucciones","imagen_url","activo"]);
  getOrCreate(SHEET_NAME_REGISTROS,  ["id","datetime","fecha","hora","group_id","group_nombre","sucursal","colaborador","area","insumos_json"]);

  // Usuario admin por defecto si no existe
  const uSheet = ss.getSheetByName(SHEET_NAME_USUARIOS);
  const data = uSheet.getDataRange().getValues();
  const exists = data.slice(1).some(row => row[4] === "admin");
  if (!exists) {
    uSheet.appendRow([1, "Administrador", "", "", "admin", "admin123", "admin", true]);
  }

  SpreadsheetApp.getUi().alert("✅ Hojas creadas correctamente. Ya puedes usar la app.");
}

// ── Punto de entrada HTTP ────────────────────────────
function doGet(e) {
  return handleRequest(e);
}
function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  const params = e.parameter || {};
  const body   = parseBody(e);
  const action = params.action || body.action || "";

  let result;
  try {
    switch (action) {
      case "login":         result = login(body);          break;
      case "getGrupos":     result = getGrupos(body);      break;
      case "getInsumos":    result = getInsumos(body);     break;
      case "getDoneGroups": result = getDoneGroups(body);  break;
      case "saveConteo":    result = saveConteo(body);     break;
      case "getRegistros":  result = getRegistros(body);   break;
      // Admin
      case "getUsuarios":   result = getUsuarios();        break;
      case "addUsuario":    result = addUsuario(body);     break;
      case "delUsuario":    result = delUsuario(body);     break;
      case "addGrupo":      result = addGrupo(body);       break;
      case "delGrupo":      result = delGrupo(body);       break;
      case "addInsumo":     result = addInsumo(body);      break;
      case "delInsumo":     result = delInsumo(body);      break;
      default:              result = { ok: false, error: "Acción desconocida: " + action };
    }
  } catch(err) {
    result = { ok: false, error: err.toString() };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function parseBody(e) {
  try {
    if (e.postData && e.postData.contents) {
      return JSON.parse(e.postData.contents);
    }
  } catch(_) {}
  return e.parameter || {};
}

// ── AUTH ─────────────────────────────────────────────
function login({ username, password }) {
  const rows = getSheetRows(SHEET_NAME_USUARIOS);
  const user = rows.find(r => r.username == username && r.password == password && r.activo != false);
  if (!user) return { ok: false, error: "Credenciales incorrectas" };
  return { ok: true, user: { id: user.id, nombre: user.nombre, sucursal: user.sucursal, area: user.area, username: user.username, role: user.role } };
}

// ── GRUPOS ───────────────────────────────────────────
function getGrupos({ sucursal }) {
  const rows = getSheetRows(SHEET_NAME_GRUPOS);
  const grupos = rows.filter(r => r.activo != false && (!sucursal || r.sucursal == sucursal));
  return { ok: true, grupos };
}

function addGrupo({ nombre, sucursal, imagen_url }) {
  if (!nombre || !sucursal) return { ok: false, error: "Faltan datos" };
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_GRUPOS);
  const id = Date.now();
  sheet.appendRow([id, nombre, sucursal, imagen_url || "", true]);
  return { ok: true, id };
}

function delGrupo({ id }) {
  return setInactivo(SHEET_NAME_GRUPOS, id);
}

// ── INSUMOS ──────────────────────────────────────────
function getInsumos({ group_id }) {
  const rows = getSheetRows(SHEET_NAME_INSUMOS);
  const insumos = rows.filter(r => r.activo != false && (!group_id || String(r.group_id) == String(group_id)));
  return { ok: true, insumos };
}

function addInsumo({ group_id, nombre, unidad, ubicacion, instrucciones, imagen_url }) {
  if (!group_id || !nombre || !unidad) return { ok: false, error: "Faltan datos" };
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_INSUMOS);
  const id = Date.now();
  sheet.appendRow([id, group_id, nombre, unidad, ubicacion || "", instrucciones || "", imagen_url || "", true]);
  return { ok: true, id };
}

function delInsumo({ id }) {
  return setInactivo(SHEET_NAME_INSUMOS, id);
}

// ── CONTEOS ──────────────────────────────────────────
function getDoneGroups({ sucursal, fecha }) {
  const rows = getSheetRows(SHEET_NAME_REGISTROS);
  const hoy = fecha || today();
  const doneIds = rows
    .filter(r => r.sucursal == sucursal && r.fecha == hoy)
    .map(r => String(r.group_id));
  return { ok: true, doneIds };
}

function saveConteo({ group_id, group_nombre, sucursal, colaborador, area, items }) {
  if (!group_id || !sucursal || !colaborador) return { ok: false, error: "Faltan datos" };
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_REGISTROS);
  const now  = new Date();
  const fecha = Utilities.formatDate(now, "America/Mexico_City", "yyyy-MM-dd");
  const hora  = Utilities.formatDate(now, "America/Mexico_City", "HH:mm");
  const dt    = Utilities.formatDate(now, "America/Mexico_City", "dd/MM/yyyy HH:mm");
  const id    = now.getTime();
  sheet.appendRow([id, dt, fecha, hora, group_id, group_nombre, sucursal, colaborador, area, JSON.stringify(items)]);
  return { ok: true };
}

function getRegistros({ sucursal }) {
  const rows = getSheetRows(SHEET_NAME_REGISTROS);
  const filtered = sucursal && sucursal !== "Todas"
    ? rows.filter(r => r.sucursal == sucursal)
    : rows;
  // Parsear insumos_json
  const registros = filtered.map(r => ({
    ...r,
    items: (() => { try { return JSON.parse(r.insumos_json); } catch(_) { return []; } })()
  }));
  return { ok: true, registros: registros.reverse() };
}

// ── USUARIOS (admin) ─────────────────────────────────
function getUsuarios() {
  const rows = getSheetRows(SHEET_NAME_USUARIOS);
  const usuarios = rows.filter(r => r.role !== "admin" && r.activo != false)
    .map(r => ({ id: r.id, nombre: r.nombre, sucursal: r.sucursal, area: r.area, username: r.username }));
  return { ok: true, usuarios };
}

function addUsuario({ nombre, sucursal, area, username, password }) {
  if (!nombre || !sucursal || !area || !username || !password) return { ok: false, error: "Faltan datos" };
  const rows = getSheetRows(SHEET_NAME_USUARIOS);
  if (rows.find(r => r.username == username)) return { ok: false, error: "Usuario ya existe" };
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_USUARIOS);
  const id = Date.now();
  sheet.appendRow([id, nombre, sucursal, area, username, password, "colaborador", true]);
  return { ok: true, id };
}

function delUsuario({ id }) {
  return setInactivo(SHEET_NAME_USUARIOS, id);
}

// ── HELPERS ──────────────────────────────────────────
function getSheetRows(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

function setInactivo(sheetName, id) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  const data  = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf("id");
  const activoCol = headers.indexOf("activo");
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) == String(id)) {
      sheet.getRange(i + 1, activoCol + 1).setValue(false);
      return { ok: true };
    }
  }
  return { ok: false, error: "No encontrado" };
}

function today() {
  return Utilities.formatDate(new Date(), "America/Mexico_City", "yyyy-MM-dd");
}
