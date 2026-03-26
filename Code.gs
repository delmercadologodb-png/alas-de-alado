// =====================================================
//  ALAS DE ALADO — Backend Google Apps Script
// =====================================================

const SHEET_NAME_REGISTROS  = "Registros";
const SHEET_NAME_USUARIOS   = "Usuarios";
const SHEET_NAME_GRUPOS     = "Grupos";
const SHEET_NAME_INSUMOS    = "Insumos";
const SHEET_NAME_EN_PROCESO = "EnProceso";
const SHEET_NAME_BORRADORES = "Borradores";

// ── SESIONES ──────────────────────────────────────────
// Tabla en memoria de tokens activos { token -> { userId, nombre, role, sucursal, area, exp } }
// Como GAS no persiste variables globales entre llamadas, usamos la hoja Sesiones
const SHEET_NAME_SESIONES = "Sesiones";

function getSesionesSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME_SESIONES);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME_SESIONES);
    sheet.getRange(1,1,1,5).setValues([["token","user_id","nombre","role","expires"]]);
    sheet.getRange(1,1,1,5).setBackground("#D32F2F").setFontColor("#ffffff").setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function crearSesion(user) {
  // Token aleatorio simple: timestamp + random
  const token = Utilities.base64Encode(
    user.id + "_" + Date.now() + "_" + Math.random().toString(36).slice(2)
  );
  const exp = new Date(Date.now() + 12 * 60 * 60 * 1000); // 12 horas
  const sheet = getSesionesSheet();
  sheet.appendRow([token, user.id, user.nombre, user.role,
    Utilities.formatDate(exp, "America/Mexico_City", "yyyy-MM-dd HH:mm:ss")]);
  limpiarSesionesExpiradas();
  return token;
}

function validarSesion(token) {
  if (!token) return null;
  const sheet = getSesionesSheet();
  const data  = sheet.getDataRange().getValues();
  if (data.length < 2) return null;
  const headers = data[0];
  const tCol   = headers.indexOf("token");
  const nCol   = headers.indexOf("nombre");
  const rCol   = headers.indexOf("role");
  const expCol = headers.indexOf("expires");
  const now    = new Date();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][tCol]).trim() === String(token).trim()) {
      const exp = new Date(data[i][expCol]);
      if (exp > now) {
        return { nombre: data[i][nCol], role: data[i][rCol] };
      }
    }
  }
  return null;
}

function limpiarSesionesExpiradas() {
  const sheet = getSesionesSheet();
  const data  = sheet.getDataRange().getValues();
  if (data.length < 2) return;
  const headers = data[0];
  const expCol  = headers.indexOf("expires");
  const now     = new Date();
  for (let i = data.length - 1; i >= 1; i--) {
    if (new Date(data[i][expCol]) < now) {
      sheet.deleteRow(i + 1);
    }
  }
}

function invalidarSesion(token) {
  if (!token) return;
  const sheet = getSesionesSheet();
  const data  = sheet.getDataRange().getValues();
  if (data.length < 2) return;
  const tCol = data[0].indexOf("token");
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][tCol]).trim() === String(token).trim()) {
      sheet.deleteRow(i + 1);
    }
  }
}

// ── HELPER: NORMALIZAR FECHAS ─────────────────────────
function normalizarFecha(fecha) {
  if (!fecha) return '';
  if (fecha instanceof Date) {
    return Utilities.formatDate(fecha, "America/Mexico_City", "yyyy-MM-dd");
  }
  const fechaStr = String(fecha);
  if (fechaStr.includes('/') && (fechaStr.includes(' ') || fechaStr.includes(':'))) {
    const partesFecha = fechaStr.split(' ')[0].split('/');
    if (partesFecha.length === 3)
      return `${partesFecha[2]}-${partesFecha[1].padStart(2,'0')}-${partesFecha[0].padStart(2,'0')}`;
  }
  if (fechaStr.includes('/') && !fechaStr.includes(' ')) {
    const partes = fechaStr.split('/');
    if (partes.length === 3)
      return `${partes[2]}-${partes[1].padStart(2,'0')}-${partes[0].padStart(2,'0')}`;
  }
  if (fechaStr.match(/^\d{4}-\d{2}-\d{2}$/)) return fechaStr;
  return fechaStr;
}

// ── ELIMINAR DE EN PROCESO ────────────────────────────
function eliminarDeEnProceso(groupId, colaborador) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_EN_PROCESO);
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return;
  const headers = data[0];
  const gCol = headers.indexOf("group_id");
  const cCol = headers.indexOf("colaborador");
  if (gCol === -1 || cCol === -1) return;
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][gCol]).trim() === String(groupId).trim() &&
        String(data[i][cCol]).trim() === String(colaborador).trim()) {
      sheet.deleteRow(i + 1);
    }
  }
}

// ── RESPUESTA ESTÁNDAR ───────────────────────────────
function buildResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── GET ──────────────────────────────────────────────
function doGet(e) {
  const params = e.parameter || {};
  const action = params.action || "";
  let result;
  try { result = dispatch(action, params); }
  catch(err) { result = { ok: false, error: err.toString() }; }
  return buildResponse(result);
}

// ── POST ─────────────────────────────────────────────
function doPost(e) {
  let body = {};
  try {
    if (e.postData && e.postData.contents) body = JSON.parse(e.postData.contents);
  } catch(_) { body = e.parameter || {}; }
  const action = body.action || (e.parameter && e.parameter.action) || "";
  let result;
  try { result = dispatch(action, body); }
  catch(err) { result = { ok: false, error: err.toString() }; }
  return buildResponse(result);
}

// ── DISPATCHER ───────────────────────────────────────
function dispatch(action, data) {
  switch (action) {
    // Auth — sin validación de token
    case "login":          return login(data);
    case "logout":         return logoutAction(data);
    case "ping":           return { ok: true, msg: "pong" };

    // Todo lo demás requiere token válido
    default: {
      const sesion = validarSesion(data.token);
      if (!sesion) return { ok: false, error: "session_expired" };
      return dispatchAutenticado(action, data, sesion);
    }
  }
}

function dispatchAutenticado(action, data, sesion) {
  switch (action) {
    case "getGrupos":      return getGrupos(data);
    case "getInsumos":     return getInsumos(data);
    case "getDoneGroups":  return getDoneGroups(data);
    case "saveConteo":     return saveConteo(data);
    case "getRegistros":   return getRegistros(data);
    case "getUsuarios":    return getUsuarios();
    case "addUsuario":     return addUsuario(data);
    case "delUsuario":     return delUsuario(data);
    case "addGrupo":       return addGrupo(data);
    case "delGrupo":       return delGrupo(data);
    case "updateGrupo":    return updateGrupo(data);
    case "addInsumo":      return addInsumo(data);
    case "delInsumo":      return delInsumo(data);
    case "startConteo":    return startConteo(data);
    case "cancelConteo":   return cancelConteo(data);
    case "getEnProceso":   return getEnProceso(data);
    case "saveBorrador":   return saveBorrador(data);
    case "getBorrador":    return getBorrador(data);
    case "getBorradoresUsuario": return getBorradoresUsuario(data);
    case "deleteBorrador": return deleteBorrador(data);
    default:               return { ok: false, error: "Acción desconocida: " + action };
  }
}

// ── AUTH ─────────────────────────────────────────────
function login(d) {
  const rows = getSheetRows(SHEET_NAME_USUARIOS);
  const user = rows.find(r =>
    String(r.username).trim() === String(d.username).trim() &&
    String(r.password).trim() === String(d.password).trim() &&
    r.activo !== false && String(r.activo) !== "FALSE"
  );
  if (!user) return { ok: false, error: "Credenciales incorrectas" };
  const token = crearSesion(user);
  return { ok: true, token, user: {
    id: user.id, nombre: user.nombre, sucursal: user.sucursal,
    area: user.area, username: user.username, role: user.role
  }};
}

function logoutAction(d) {
  invalidarSesion(d.token);
  return { ok: true };
}

// ── GRUPOS ───────────────────────────────────────────
function getGrupos(d) {
  const rows = getSheetRows(SHEET_NAME_GRUPOS);
  const grupos = rows.filter(r =>
    r.activo !== false && String(r.activo) !== "FALSE" &&
    (!d.sucursal || String(r.sucursal) === String(d.sucursal))
  );
  return { ok: true, grupos };
}

function addGrupo(d) {
  if (!d.nombre || !d.sucursal) return { ok: false, error: "Faltan datos" };
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_GRUPOS);
  const id = Date.now();
  sheet.appendRow([id, d.nombre, d.sucursal, d.imagen_url || "", true, d.area_color || "", d.dias_activo || ""]);
  return { ok: true, id };
}

function updateGrupo(d) {
  if (!d.id) return { ok: false, error: "Falta id" };
  const sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_GRUPOS);
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol   = headers.indexOf("id");
  let areaCol   = headers.indexOf("area_color");
  let diasCol   = headers.indexOf("dias_activo");
  if (areaCol === -1) {
    areaCol = headers.length;
    sheet.getRange(1, areaCol + 1).setValue("area_color");
  }
  if (diasCol === -1) {
    diasCol = headers.length + (areaCol === headers.length ? 1 : 0);
    sheet.getRange(1, diasCol + 1).setValue("dias_activo");
  }
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(d.id)) {
      sheet.getRange(i + 1, areaCol + 1).setValue(d.area_color || "");
      sheet.getRange(i + 1, diasCol  + 1).setValue(d.dias_activo || "");
      return { ok: true };
    }
  }
  return { ok: false, error: "Grupo no encontrado" };
}

function delGrupo(d) { return setInactivo(SHEET_NAME_GRUPOS, d.id); }

// ── INSUMOS ──────────────────────────────────────────
function getInsumos(d) {
  const rows = getSheetRows(SHEET_NAME_INSUMOS);
  const insumos = rows.filter(r =>
    r.activo !== false && String(r.activo) !== "FALSE" &&
    (!d.group_id || String(r.group_id) === String(d.group_id))
  );
  return { ok: true, insumos };
}

function addInsumo(d) {
  if (!d.group_id || !d.nombre || !d.unidad)
    return { ok: false, error: "Faltan datos obligatorios (grupo, nombre, unidad)" };
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_INSUMOS);
  const id = Date.now();
  sheet.appendRow([id, d.group_id, d.nombre, d.unidad, d.ubicacion || "", d.instrucciones || "", d.imagen_url || "", true]);
  return { ok: true, id };
}

function delInsumo(d) { return setInactivo(SHEET_NAME_INSUMOS, d.id); }

// ── GET SHEET ROWS ───────────────────────────────────
function getSheetRows(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      let valor = row[i];
      if (h === "fecha" && name === SHEET_NAME_REGISTROS && valor)
        valor = normalizarFecha(valor);
      obj[h] = valor;
    });
    return obj;
  });
}

// ── CONTEOS ──────────────────────────────────────────
function getDoneGroups(d) {
  const rows = getSheetRows(SHEET_NAME_REGISTROS);
  const hoy  = d.fecha || today();
  const doneGroups = rows
    .filter(r => String(r.sucursal) === String(d.sucursal) && String(r.fecha) === String(hoy))
    .map(r => ({ group_id: String(r.group_id), group_nombre: r.group_nombre, datetime: r.datetime }));
  const enProceso = getSheetRows(SHEET_NAME_EN_PROCESO)
    .filter(r => !d.sucursal || String(r.sucursal) === String(d.sucursal))
    .map(r => ({ group_id: String(r.group_id), colaborador: r.colaborador }));
  return { ok: true, doneIds: doneGroups.map(g => g.group_id), doneGroups, enProceso };
}

function saveConteo(d) {
  if (!d.group_id || !d.sucursal || !d.colaborador)
    return { ok: false, error: "Faltan datos obligatorios" };
  const registros = getSheetRows(SHEET_NAME_REGISTROS);
  const hoy       = today();
  const groupId   = String(d.group_id).trim();
  const sucursal  = String(d.sucursal).trim();
  const existeRegistro = registros.some(r =>
    String(r.group_id).trim() === groupId &&
    String(r.sucursal).trim() === sucursal &&
    String(r.fecha) === hoy
  );
  if (existeRegistro) return { ok: false, error: "Ya existe un inventario para este grupo hoy." };
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_REGISTROS);
  const now   = new Date();
  const fecha = Utilities.formatDate(now, "America/Mexico_City", "yyyy-MM-dd");
  const hora  = Utilities.formatDate(now, "America/Mexico_City", "HH:mm");
  const dt    = Utilities.formatDate(now, "America/Mexico_City", "dd/MM/yyyy HH:mm");
  const id    = now.getTime();
  let items = d.items || [];
  if (typeof items === "string") { try { items = JSON.parse(items); } catch(_) { items = []; } }
  sheet.appendRow([id, dt, fecha, hora, groupId, d.group_nombre, sucursal, d.colaborador, d.area, JSON.stringify(items)]);
  eliminarDeEnProceso(groupId, d.colaborador);
  return { ok: true, message: "Inventario guardado correctamente" };
}

function getRegistros(d) {
  const rows = getSheetRows(SHEET_NAME_REGISTROS);
  const filtered = (d.sucursal && d.sucursal !== "Todas")
    ? rows.filter(r => String(r.sucursal) === String(d.sucursal))
    : rows;
  const registros = filtered.map(r => ({
    ...r,
    items: (() => { try { return JSON.parse(r.insumos_json); } catch(_) { return []; } })()
  })).reverse();
  return { ok: true, registros };
}

// ── USUARIOS ─────────────────────────────────────────
function getUsuarios() {
  const rows = getSheetRows(SHEET_NAME_USUARIOS);
  const usuarios = rows
    .filter(r => r.role !== "admin" && r.activo !== false && String(r.activo) !== "FALSE")
    .map(r => ({ id: r.id, nombre: r.nombre, sucursal: r.sucursal, area: r.area, username: r.username }));
  return { ok: true, usuarios };
}

function addUsuario(d) {
  if (!d.nombre || !d.sucursal || !d.area || !d.username || !d.password)
    return { ok: false, error: "Faltan datos" };
  const rows = getSheetRows(SHEET_NAME_USUARIOS);
  if (rows.find(r => String(r.username) === String(d.username)))
    return { ok: false, error: "Usuario ya existe" };
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_USUARIOS);
  const id = Date.now();
  sheet.appendRow([id, d.nombre, d.sucursal, d.area, d.username, d.password, "colaborador", true]);
  return { ok: true, id };
}

function delUsuario(d) { return setInactivo(SHEET_NAME_USUARIOS, d.id); }

// ── EN PROCESO ───────────────────────────────────────
function getEnProceso(d) {
  limpiarEnProceso();
  const rows = getSheetRows(SHEET_NAME_EN_PROCESO);
  const activos = rows.filter(r => !d.sucursal || String(r.sucursal) === String(d.sucursal));
  return { ok: true, enProceso: activos };
}

function startConteo(d) {
  if (!d.group_id || !d.sucursal || !d.colaborador)
    return { ok: false, error: "Faltan datos" };
  const groupId    = String(d.group_id).trim();
  const sucursal   = String(d.sucursal).trim();
  const colaborador = String(d.colaborador).trim();
  // 1. ¿Ya terminado hoy?
  const registros = getSheetRows(SHEET_NAME_REGISTROS);
  const hoy = today();
  const yaTerminado = registros.some(r =>
    String(r.group_id).trim() === groupId &&
    String(r.sucursal).trim() === sucursal &&
    String(r.fecha) === hoy
  );
  if (yaTerminado) return { ok: false, error: "Este grupo ya tiene un inventario registrado hoy" };
  // 2. ¿En proceso por otro?
  const enProceso = getSheetRows(SHEET_NAME_EN_PROCESO);
  const existing = enProceso.find(r =>
    String(r.group_id).trim() === groupId &&
    String(r.sucursal).trim() === sucursal &&
    String(r.colaborador).trim() !== colaborador
  );
  if (existing) return { ok: false, error: "En proceso por " + existing.colaborador, colaborador: existing.colaborador };
  // 3. Limpiar entrada previa del mismo usuario y registrar
  eliminarDeEnProceso(groupId, colaborador);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_EN_PROCESO);
  const ts = Utilities.formatDate(new Date(), "America/Mexico_City", "yyyy-MM-dd HH:mm:ss");
  sheet.appendRow([groupId, sucursal, colaborador, ts]);
  return { ok: true };
}

function cancelConteo(d) {
  if (!d.group_id || !d.colaborador) return { ok: false };
  eliminarDeEnProceso(d.group_id, d.colaborador);
  return { ok: true };
}

// ── LIMPIEZA AUTOMÁTICA DE EN PROCESO ────────────────
// Se ejecuta automáticamente cada hora via trigger de tiempo.
// Para instalarlo: ejecuta crearTriggerLimpieza() UNA sola vez desde el editor.
function limpiarEnProceso() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_EN_PROCESO);
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return;
  const headers = data[0];
  const tsCol   = headers.indexOf("timestamp");
  const now     = new Date();
  for (let i = data.length - 1; i >= 1; i--) {
    const ts = new Date(data[i][tsCol]);
    if ((now - ts) > 2 * 60 * 60 * 1000) { // más de 2 horas
      sheet.deleteRow(i + 1);
    }
  }
}

function crearTriggerLimpieza() {
  // Ejecuta esta función UNA sola vez desde el editor para instalar el trigger permanente.
  // Verifica que no exista ya para no duplicar.
  const triggers = ScriptApp.getProjectTriggers();
  const yaExiste = triggers.some(t => t.getHandlerFunction() === 'limpiarEnProceso');
  if (yaExiste) {
    SpreadsheetApp.getUi().alert('El trigger ya existe. No se creó un duplicado.');
    return;
  }
  ScriptApp.newTrigger('limpiarEnProceso')
    .timeBased()
    .everyHours(1)
    .create();
  SpreadsheetApp.getUi().alert('✅ Trigger de limpieza creado. Se ejecutará cada hora.');
}

function limpiarEnProcesoForzado() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_EN_PROCESO);
  if (!sheet) return { ok: false, error: "Hoja no encontrada" };
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);
  return { ok: true, message: "Hoja EnProceso limpiada completamente" };
}

// ── BORRADORES ───────────────────────────────────────
function saveBorrador(d) {
  if (!d.group_id || !d.colaborador || !d.turno) return { ok: false, error: "Faltan datos" };
  const sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_BORRADORES);
  if (!sheet) return { ok: false, error: "Hoja Borradores no existe" };
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const gCol    = headers.indexOf("group_id");
  const cCol    = headers.indexOf("colaborador");
  const tCol    = headers.indexOf("turno");
  const tsCol   = headers.indexOf("timestamp");
  const jCol    = headers.indexOf("counts_json");
  const ts = Utilities.formatDate(new Date(), "America/Mexico_City", "HH:mm");
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][gCol]).trim() === String(d.group_id).trim() &&
        String(data[i][cCol]).trim() === String(d.colaborador).trim() &&
        String(data[i][tCol]).trim() === String(d.turno).trim()) {
      sheet.getRange(i+1, jCol+1).setValue(typeof d.counts_json === 'string' ? d.counts_json : JSON.stringify(d.counts_json));
      sheet.getRange(i+1, tsCol+1).setValue(ts);
      return { ok: true };
    }
  }
  sheet.appendRow([
    String(d.group_id), d.sucursal || '', d.colaborador, d.turno,
    typeof d.counts_json === 'string' ? d.counts_json : JSON.stringify(d.counts_json), ts
  ]);
  return { ok: true };
}

function getBorrador(d) {
  if (!d.group_id || !d.colaborador || !d.turno) return { ok: false };
  const rows = getSheetRows(SHEET_NAME_BORRADORES);
  const b = rows.find(r =>
    String(r.group_id).trim()    === String(d.group_id).trim() &&
    String(r.colaborador).trim() === String(d.colaborador).trim() &&
    String(r.turno).trim()       === String(d.turno).trim()
  );
  if (!b) return { ok: true, borrador: null };
  return { ok: true, borrador: b };
}

// Nueva acción: devuelve TODOS los borradores del turno para un colaborador
function getBorradoresUsuario(d) {
  if (!d.colaborador || !d.turno) return { ok: false, error: "Faltan datos" };
  const rows = getSheetRows(SHEET_NAME_BORRADORES);
  const borradoresDelTurno = rows.filter(r =>
    String(r.colaborador).trim() === String(d.colaborador).trim() &&
    String(r.turno).trim()       === String(d.turno).trim()
  );
  return { ok: true, borradores: borradoresDelTurno };
}

function deleteBorrador(d) {
  if (!d.group_id || !d.colaborador) return { ok: false };
  const sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_BORRADORES);
  if (!sheet) return { ok: true };
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const gCol    = headers.indexOf("group_id");
  const cCol    = headers.indexOf("colaborador");
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][gCol]).trim() === String(d.group_id).trim() &&
        String(data[i][cCol]).trim() === String(d.colaborador).trim()) {
      sheet.deleteRow(i + 1);
    }
  }
  return { ok: true };
}

// ── HELPERS ──────────────────────────────────────────
function setInactivo(sheetName, id) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  const data  = sheet.getDataRange().getValues();
  const headers    = data[0];
  const idCol      = headers.indexOf("id");
  const activoCol  = headers.indexOf("activo");
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(id)) {
      sheet.getRange(i + 1, activoCol + 1).setValue(false);
      return { ok: true };
    }
  }
  return { ok: false, error: "No encontrado" };
}

function today() {
  return Utilities.formatDate(new Date(), "America/Mexico_City", "yyyy-MM-dd");
}

// ── INICIALIZAR HOJAS ────────────────────────────────
function inicializarHojas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  function getOrCreate(name, headers) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.getRange(1,1,1,headers.length).setValues([headers]);
      sheet.getRange(1,1,1,headers.length).setBackground("#D32F2F").setFontColor("#ffffff").setFontWeight("bold");
      sheet.setFrozenRows(1);
    }
    return sheet;
  }
  getOrCreate(SHEET_NAME_USUARIOS,   ["id","nombre","sucursal","area","username","password","role","activo"]);
  getOrCreate(SHEET_NAME_GRUPOS,     ["id","nombre","sucursal","imagen_url","activo","area_color","dias_activo"]);
  getOrCreate(SHEET_NAME_INSUMOS,    ["id","group_id","nombre","unidad","ubicacion","instrucciones","imagen_url","activo"]);
  getOrCreate(SHEET_NAME_REGISTROS,  ["id","datetime","fecha","hora","group_id","group_nombre","sucursal","colaborador","area","insumos_json"]);
  getOrCreate(SHEET_NAME_EN_PROCESO, ["group_id","sucursal","colaborador","timestamp"]);
  getOrCreate(SHEET_NAME_BORRADORES, ["group_id","sucursal","colaborador","turno","counts_json","timestamp"]);
  getOrCreate(SHEET_NAME_SESIONES,   ["token","user_id","nombre","role","expires"]);
  const uSheet = ss.getSheetByName(SHEET_NAME_USUARIOS);
  const data   = uSheet.getDataRange().getValues();
  const exists = data.slice(1).some(row => row[4] === "admin");
  if (!exists) {
    uSheet.appendRow([1,"Administrador","","","admin","admin123","admin",true]);
  }
  SpreadsheetApp.getUi().alert("✅ Hojas creadas correctamente.");
}

// ── DIAGNÓSTICO ──────────────────────────────────────
function diagnosticarCompleto() {
  const registros = getSheetRows(SHEET_NAME_REGISTROS);
  const hoy       = today();
  const registrosHoy = registros.filter(r => String(r.fecha) === hoy);
  const enProceso    = getSheetRows(SHEET_NAME_EN_PROCESO);
  return {
    ok: true, hoy,
    registrosHoy: registrosHoy.length,
    registrosHoyDetalle: registrosHoy.map(r => ({ id: r.group_id, nombre: r.group_nombre })),
    enProceso: enProceso.length,
    enProcesoDetalle: enProceso
  };
}

function corregirFechasExistentes() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_REGISTROS);
  if (!sheet) return { ok: false, error: "Hoja Registros no encontrada" };
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const fechaCol = headers.indexOf("fecha");
  if (fechaCol === -1) return { ok: false, error: "Columna fecha no encontrada" };
  let cambios = 0;
  for (let i = 1; i < data.length; i++) {
    const fechaActual = data[i][fechaCol];
    if (fechaActual && typeof fechaActual === 'string' && fechaActual.includes('/')) {
      const partes = fechaActual.includes(' ')
        ? fechaActual.split(' ')[0].split('/')
        : fechaActual.split('/');
      if (partes.length === 3) {
        const nuevaFecha = `${partes[2]}-${partes[1].padStart(2,'0')}-${partes[0].padStart(2,'0')}`;
        if (nuevaFecha !== fechaActual) {
          sheet.getRange(i+1, fechaCol+1).setValue(nuevaFecha);
          cambios++;
        }
      }
    }
  }
  return { ok: true, message: `✅ Corregidas ${cambios} filas con formato de fecha` };
}
