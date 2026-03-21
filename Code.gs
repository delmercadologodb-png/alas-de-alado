// =====================================================
//  ALAS DE ALADO — Backend Google Apps Script
//  Versión FINAL con diagnóstico y correcciones
// =====================================================

const SHEET_NAME_REGISTROS = "Registros";
const SHEET_NAME_USUARIOS   = "Usuarios";
const SHEET_NAME_GRUPOS     = "Grupos";
const SHEET_NAME_INSUMOS    = "Insumos";
const SHEET_NAME_EN_PROCESO  = "EnProceso";

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
  getOrCreate(SHEET_NAME_EN_PROCESO,  ["group_id","sucursal","colaborador","timestamp"]);

  const uSheet = ss.getSheetByName(SHEET_NAME_USUARIOS);
  const data = uSheet.getDataRange().getValues();
  const exists = data.slice(1).some(row => row[4] === "admin");
  if (!exists) {
    uSheet.appendRow([1, "Administrador", "", "", "admin", "admin123", "admin", true]);
  }

  SpreadsheetApp.getUi().alert("✅ Hojas creadas correctamente.");
}

// ── HELPER: NORMALIZAR FECHAS ─────────────────────────
function normalizarFecha(fecha) {
  if (!fecha) return '';
  
  if (fecha instanceof Date) {
    return Utilities.formatDate(fecha, "America/Mexico_City", "yyyy-MM-dd");
  }
  
  const fechaStr = String(fecha);
  
  // Formato "DD/MM/YYYY HH:MM"
  if (fechaStr.includes('/') && (fechaStr.includes(' ') || fechaStr.includes(':'))) {
    const partesFecha = fechaStr.split(' ')[0].split('/');
    if (partesFecha.length === 3) {
      return `${partesFecha[2]}-${partesFecha[1].padStart(2,'0')}-${partesFecha[0].padStart(2,'0')}`;
    }
  }
  
  // Formato "DD/MM/YYYY"
  if (fechaStr.includes('/') && !fechaStr.includes(' ')) {
    const partes = fechaStr.split('/');
    if (partes.length === 3) {
      return `${partes[2]}-${partes[1].padStart(2,'0')}-${partes[0].padStart(2,'0')}`;
    }
  }
  
  // Formato "YYYY-MM-DD"
  if (fechaStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return fechaStr;
  }
  
  return fechaStr;
}

// ── FUNCIÓN PARA ELIMINAR DE EN PROCESO ──────────────
function eliminarDeEnProceso(groupId, colaborador) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_EN_PROCESO);
  if (!sheet) return;
  
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return;
  
  const headers = data[0];
  const gCol = headers.indexOf("group_id");
  const cCol = headers.indexOf("colaborador");
  
  if (gCol === -1 || cCol === -1) return;
  
  let eliminados = 0;
  for (let i = data.length - 1; i >= 1; i--) {
    const rowGroupId = String(data[i][gCol]).trim();
    const rowColaborador = String(data[i][cCol]).trim();
    
    if (rowGroupId === String(groupId).trim() && rowColaborador === String(colaborador).trim()) {
      sheet.deleteRow(i + 1);
      eliminados++;
    }
  }
  
  if (eliminados > 0) {
    console.log(`🗑️ Eliminadas ${eliminados} fila(s) de EnProceso`);
  }
}

// ── Toda respuesta pasa por aquí ─────────────────────
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
  try {
    result = dispatch(action, params);
  } catch(err) {
    result = { ok: false, error: err.toString() };
  }
  return buildResponse(result);
}

// ── POST ─────────────────────────────────────────────
function doPost(e) {
  let body = {};
  try {
    if (e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }
  } catch(_) {
    body = e.parameter || {};
  }
  const action = body.action || (e.parameter && e.parameter.action) || "";
  let result;
  try {
    result = dispatch(action, body);
  } catch(err) {
    result = { ok: false, error: err.toString() };
  }
  return buildResponse(result);
}

// ── DISPATCHER ───────────────────────────────────────
function dispatch(action, data) {
  switch (action) {
    case "login":         return login(data);
    case "getGrupos":     return getGrupos(data);
    case "getInsumos":    return getInsumos(data);
    case "getDoneGroups": return getDoneGroups(data);
    case "saveConteo":    return saveConteo(data);
    case "getRegistros":  return getRegistros(data);
    case "getUsuarios":   return getUsuarios();
    case "addUsuario":    return addUsuario(data);
    case "delUsuario":    return delUsuario(data);
    case "addGrupo":      return addGrupo(data);
    case "delGrupo":      return delGrupo(data);
    case "addInsumo":     return addInsumo(data);
    case "delInsumo":     return delInsumo(data);
    case "ping":          return { ok: true, msg: "pong" };
    case "startConteo":   return startConteo(data);
    case "cancelConteo":  return cancelConteo(data);
    case "getEnProceso":  return getEnProceso(data);
    default:              return { ok: false, error: "Acción desconocida: " + action };
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
  return { ok: true, user: {
    id: user.id, nombre: user.nombre, sucursal: user.sucursal,
    area: user.area, username: user.username, role: user.role
  }};
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
  sheet.appendRow([id, d.nombre, d.sucursal, d.imagen_url || "", true]);
  return { ok: true, id };
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
  
  sheet.appendRow([
    id, 
    d.group_id, 
    d.nombre, 
    d.unidad, 
    d.ubicacion || "", 
    d.instrucciones || "", 
    d.imagen_url || "", 
    true
  ]);
  
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
      if (h === "fecha" && name === SHEET_NAME_REGISTROS && valor) {
        valor = normalizarFecha(valor);
      }
      obj[h] = valor; 
    });
    return obj;
  });
}

// ── CONTEOS ──────────────────────────────────────────
function getDoneGroups(d) {
  const rows = getSheetRows(SHEET_NAME_REGISTROS);
  const hoy = d.fecha || today();
  
  console.log('=== getDoneGroups ===');
  console.log('Sucursal:', d.sucursal);
  console.log('Fecha hoy:', hoy);
  console.log('Total registros:', rows.length);
  
  const doneGroups = rows
    .filter(r => {
      const fechaNormalizada = String(r.fecha);
      const coincide = String(r.sucursal) === String(d.sucursal) && fechaNormalizada === String(hoy);
      return coincide;
    })
    .map(r => ({
      group_id: String(r.group_id),
      group_nombre: r.group_nombre,
      datetime: r.datetime
    }));
  
  console.log('Grupos terminados hoy:', doneGroups.length);
  console.log('IDs:', doneGroups.map(g => g.group_id));
  
  const enProceso = getSheetRows(SHEET_NAME_EN_PROCESO)
    .filter(r => !d.sucursal || String(r.sucursal) === String(d.sucursal))
    .map(r => ({
      group_id: String(r.group_id),
      colaborador: r.colaborador
    }));
  
  return { 
    ok: true, 
    doneIds: doneGroups.map(g => g.group_id), 
    doneGroups, 
    enProceso 
  };
}

function saveConteo(d) {
  if (!d.group_id || !d.sucursal || !d.colaborador) 
    return { ok: false, error: "Faltan datos obligatorios" };
  
  const registros = getSheetRows(SHEET_NAME_REGISTROS);
  const hoy = today();
  const groupId = String(d.group_id).trim();
  const sucursal = String(d.sucursal).trim();
  const colaborador = String(d.colaborador).trim();
  
  console.log('=== saveConteo ===');
  console.log('Guardando grupo:', groupId);
  console.log('Fecha hoy:', hoy);
  
  const existeRegistro = registros.some(r => {
    const fechaNormalizada = String(r.fecha);
    return String(r.group_id).trim() === groupId && 
           String(r.sucursal).trim() === sucursal && 
           fechaNormalizada === hoy;
  });
  
  if (existeRegistro) {
    console.log('❌ Ya existe registro hoy');
    return { 
      ok: false, 
      error: "Ya existe un inventario para este grupo hoy. No se puede guardar otro." 
    };
  }
  
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_REGISTROS);
  const now   = new Date();
  const fecha = Utilities.formatDate(now, "America/Mexico_City", "yyyy-MM-dd");
  const hora  = Utilities.formatDate(now, "America/Mexico_City", "HH:mm");
  const dt    = Utilities.formatDate(now, "America/Mexico_City", "dd/MM/yyyy HH:mm");
  const id    = now.getTime();
  
  let items = d.items || [];
  if (typeof items === "string") { 
    try { items = JSON.parse(items); } catch(_) { items = []; } 
  }
  
  sheet.appendRow([id, dt, fecha, hora, groupId, d.group_nombre, sucursal, colaborador, d.area, JSON.stringify(items)]);
  
  eliminarDeEnProceso(groupId, colaborador);
  
  console.log('✅ Guardado exitoso');
  
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
  
  const groupId = String(d.group_id).trim();
  const sucursal = String(d.sucursal).trim();
  const colaborador = String(d.colaborador).trim();
  
  console.log('=== startConteo ===');
  console.log('Grupo:', groupId);
  console.log('Sucursal:', sucursal);
  console.log('Colaborador:', colaborador);
  
  // 1. Verificar si ya existe un inventario GUARDADO hoy
  const registros = getSheetRows(SHEET_NAME_REGISTROS);
  const hoy = today();
  
  const yaTerminado = registros.some(r => {
    const fechaNormalizada = String(r.fecha);
    return String(r.group_id).trim() === groupId && 
           String(r.sucursal).trim() === sucursal && 
           fechaNormalizada === hoy;
  });
  
  if (yaTerminado) {
    console.log('❌ Grupo ya tiene inventario registrado hoy');
    return { ok: false, error: "Este grupo ya tiene un inventario registrado hoy" };
  }
  
  // 2. Verificar si está en proceso por OTRO usuario
  const enProceso = getSheetRows(SHEET_NAME_EN_PROCESO);
  
  const existing = enProceso.find(r => {
    return String(r.group_id).trim() === groupId && 
           String(r.sucursal).trim() === sucursal && 
           String(r.colaborador).trim() !== colaborador;
  });
  
  if (existing) {
    console.log('❌ En proceso por otro usuario:', existing.colaborador);
    return { 
      ok: false, 
      error: "En proceso por " + existing.colaborador, 
      colaborador: existing.colaborador 
    };
  }
  
  // 3. Limpiar entrada previa del MISMO usuario
  eliminarDeEnProceso(groupId, colaborador);
  
  // 4. Agregar nueva entrada en proceso
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_EN_PROCESO);
  const ts = Utilities.formatDate(new Date(), "America/Mexico_City", "yyyy-MM-dd HH:mm:ss");
  sheet.appendRow([groupId, sucursal, colaborador, ts]);
  
  console.log('✅ Conteo iniciado correctamente');
  return { ok: true };
}

function cancelConteo(d) {
  if (!d.group_id || !d.colaborador) return { ok: false };
  
  console.log('=== cancelConteo ===');
  eliminarDeEnProceso(d.group_id, d.colaborador);
  
  return { ok: true };
}

function limpiarEnProceso() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_EN_PROCESO);
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return;
  
  const headers = data[0];
  const tsCol = headers.indexOf("timestamp");
  const now = new Date();
  
  for (let i = data.length - 1; i >= 1; i--) {
    const ts = new Date(data[i][tsCol]);
    if ((now - ts) > 2 * 60 * 60 * 1000) {
      sheet.deleteRow(i + 1);
    }
  }
}

// ── FUNCIONES DE DIAGNÓSTICO ─────────────────────────
function diagnosticarCompleto() {
  const registros = getSheetRows(SHEET_NAME_REGISTROS);
  const hoy = today();
  
  console.log('=== DIAGNÓSTICO COMPLETO ===');
  console.log('📅 Fecha actual:', hoy);
  console.log('📊 Total registros en Registros:', registros.length);
  
  const registrosHoy = registros.filter(r => String(r.fecha) === hoy);
  console.log('📋 Registros de hoy:', registrosHoy.length);
  registrosHoy.forEach(r => {
    console.log('  - Grupo:', r.group_id, r.group_nombre, 'Sucursal:', r.sucursal);
  });
  
  const enProceso = getSheetRows(SHEET_NAME_EN_PROCESO);
  console.log('⏳ Registros en EnProceso:', enProceso.length);
  enProceso.forEach(e => {
    console.log('  - Grupo:', e.group_id, 'Sucursal:', e.sucursal, 'Colaborador:', e.colaborador);
  });
  
  return {
    ok: true,
    hoy: hoy,
    registrosHoy: registrosHoy.length,
    registrosHoyDetalle: registrosHoy.map(r => ({ id: r.group_id, nombre: r.group_nombre })),
    enProceso: enProceso.length,
    enProcesoDetalle: enProceso
  };
}

function limpiarEnProcesoForzado() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_EN_PROCESO);
  if (!sheet) return { ok: false, error: "Hoja no encontrada" };
  
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1);
  }
  
  return { ok: true, message: "Hoja EnProceso limpiada completamente" };
}

function corregirFechasExistentes() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_REGISTROS);
  if (!sheet) return { ok: false, error: "Hoja Registros no encontrada" };
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const fechaCol = headers.indexOf("fecha");
  
  if (fechaCol === -1) return { ok: false, error: "Columna fecha no encontrada" };
  
  let cambios = 0;
  
  for (let i = 1; i < data.length; i++) {
    const fechaActual = data[i][fechaCol];
    
    if (fechaActual && typeof fechaActual === 'string' && fechaActual.includes('/')) {
      const partes = fechaActual.includes(' ') ? fechaActual.split(' ')[0].split('/') : fechaActual.split('/');
      if (partes.length === 3) {
        const nuevaFecha = `${partes[2]}-${partes[1].padStart(2,'0')}-${partes[0].padStart(2,'0')}`;
        if (nuevaFecha !== fechaActual) {
          sheet.getRange(i + 1, fechaCol + 1).setValue(nuevaFecha);
          cambios++;
          console.log(`Fila ${i+1}: ${fechaActual} -> ${nuevaFecha}`);
        }
      }
    }
  }
  
  return { ok: true, message: `✅ Corregidas ${cambios} filas con formato de fecha` };
}

// ── HELPERS ──────────────────────────────────────────
function setInactivo(sheetName, id) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  const data  = sheet.getDataRange().getValues();
  const headers   = data[0];
  const idCol     = headers.indexOf("id");
  const activoCol = headers.indexOf("activo");
  
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
