/* App de campo: registro de afectaciones en territorio, SNGR (todo el país) */
(function () {
  'use strict';

  // ----------------------------------------------------------------
  // Utilidades
  // ----------------------------------------------------------------
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }
  function clon(o) { return JSON.parse(JSON.stringify(o)); }
  function ahoraISO() { return new Date().toISOString(); }
  function dos(n) { return (n < 10 ? '0' : '') + n; }
  function idEvento() {
    var d = new Date();
    return 'AF-' + d.getFullYear() + dos(d.getMonth() + 1) + dos(d.getDate()) + '-' + dos(d.getHours()) + dos(d.getMinutes()) + '-' + uuid().slice(0, 4).toUpperCase();
  }
  function hace(ms) {
    if (!ms) return 'nunca';
    var m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return 'hace menos de 1 min';
    if (m < 60) return 'hace ' + m + ' min';
    var h = Math.floor(m / 60);
    if (h < 48) return 'hace ' + h + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
    return 'hace ' + Math.floor(h / 24) + ' días';
  }
  function fechaLegible(iso) {
    if (!iso) return '';
    var d = new Date(String(iso).length === 19 ? String(iso).replace(' ', 'T') + '-05:00' : iso);
    if (isNaN(d)) return String(iso);
    return dos(d.getDate()) + '/' + dos(d.getMonth() + 1) + ' ' + dos(d.getHours()) + ':' + dos(d.getMinutes());
  }
  function msDe(iso) {
    var d = new Date(String(iso).length === 19 ? String(iso).replace(' ', 'T') + '-05:00' : iso);
    return d.getTime();
  }
  function distancia(lat1, lon1, lat2, lon2) {
    var R = 6371008.8, r = Math.PI / 180;
    var a = Math.pow(Math.sin((lat2 - lat1) * r / 2), 2) + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.pow(Math.sin((lon2 - lon1) * r / 2), 2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  function metros(m) { return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1).replace('.', ',') + ' km'; }
  // Distancia aproximada en metros de un punto a un segmento [lon, lat] (proyección local)
  function distanciaASegmento(lat, lon, a, b) {
    var k = 111320, c = Math.cos(lat * Math.PI / 180);
    var ax = (a[0] - lon) * k * c, ay = (a[1] - lat) * k, bx = (b[0] - lon) * k * c, by = (b[1] - lat) * k;
    var dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
    var t = l ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l)) : 0;
    var px = ax + t * dx, py = ay + t * dy;
    return Math.sqrt(px * px + py * py);
  }
  function puntoEnAnillo(lon, lat, anillo) {
    var dentro = false;
    for (var i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
      var xi = anillo[i][0], yi = anillo[i][1], xj = anillo[j][0], yj = anillo[j][1];
      if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) dentro = !dentro;
    }
    return dentro;
  }
  function toast(msg, ms) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('ver');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('ver'); }, ms || 3200);
  }
  // Activo y Sin evolución desde la versión 2.1; los demás son de eventos registrados antes
  var COLOR_ESTADO = { 'Activo': '#d62728', 'Sin evolución': '#1f77b4', 'En curso': '#d62728', 'En atención': '#ff7f0e', 'Estabilizado': '#1f77b4', 'Cerrado': '#7f7f7f' };

  // ----------------------------------------------------------------
  // Estado de la app
  // ----------------------------------------------------------------
  var S = {
    sesion: null, eventos: [], eventosHora: null, fichas: [], parroquias: null,
    ficha: null, paso: 1, mapa: null, gpsWatch: null, pila: []
  };
  var VACIO = {};
  var LISTAS = ['Origen', 'Nivel del Agua', 'Tendencia del Agua', 'Estado del Evento', 'Solicitud de Cierre',
    'Hay Personas Afectadas', 'Hay Viviendas Afectadas', 'Descripción de la Afectación',
    'Agua Potable', 'Alcantarillado o Pozos Sépticos', 'Energía Eléctrica', 'Telefonía e Internet', 'Vía de Acceso',
    'Funcionamiento Edificaciones Públicas', 'Funcionamiento Muelles', 'Justificación de Baja', 'Provincia', 'Código Parroquia', 'Cantón', 'Parroquia', 'Sector', 'Descripción', 'Tipo de Evento'];
  var CIFRAS = Object.keys(ETIQUETAS);
  var MULTI = ['Grupos Prioritarios', 'Necesidades Inmediatas'];
  LISTAS.forEach(function (k) { VACIO[k] = ''; });
  CIFRAS.forEach(function (k) { VACIO[k] = ''; });
  MULTI.forEach(function (k) { VACIO[k] = []; });

  function cargarDatos() {
    return Promise.all([DB.kvGet('sesion'), DB.kvGet('eventos'), DB.kvGet('eventosHora'), DB.todos('fichas'), DB.kvGet('authError')]).then(function (r) {
      S.sesion = r[0] || null; S.eventos = r[1] || []; S.eventosHora = r[2] || null; S.fichas = r[3] || []; S.authError = r[4] || '';
    });
  }

  // Eventos del servidor más los creados en este teléfono que aún no llegan al servidor
  function listaEventos() {
    var ids = {};
    var lista = S.eventos.map(function (e) { ids[e.id_evento] = true; return Object.assign({ local: false }, e); });
    S.fichas.forEach(function (f) {
      if (f.tipo !== 'INICIAL' || f.estado === 'borrador' || ids[f.id_evento] || ids[f.id_evento_servidor]) return;
      ids[f.id_evento] = true;
      lista.push({
        id_evento: f.id_evento, canton: f.valores['Cantón'], parroquia: f.valores['Parroquia'], sector: f.valores['Sector'],
        lat: f.ubicacion.lat, lon: f.ubicacion.lon, estado: f.valores['Estado del Evento'], ultima_obs: f.fecha_observacion,
        valores: f.valores, geometrias: (f.geometrias || []).map(function (g) { return geomAServidor(g); }), local: true, visitas: []
      });
    });
    // Actualizaciones locales aún no enviadas: la más reciente manda en la precarga
    S.fichas.forEach(function (f) {
      if (f.tipo !== 'ACTUALIZACION' || f.estado === 'borrador' || f.estado === 'enviada') return;
      var ev = lista.find(function (e) { return e.id_evento === f.id_evento; });
      if (ev && msDe(f.fecha_observacion) > msDe(ev.ultima_obs)) {
        ev.valores = f.valores; ev.estado = f.valores['Estado del Evento']; ev.ultima_obs = f.fecha_observacion; ev.local_pendiente = true;
      }
    });
    return lista;
  }
  function geomAServidor(g) {
    var fm = formaGeo(g.tipo);
    var gj = fm === 'poligono' ? { type: 'Polygon', coordinates: [g.coordenadas.concat([g.coordenadas[0]])] } : fm === 'linea' ? { type: 'LineString', coordinates: g.coordenadas } : { type: 'Point', coordinates: g.coordenadas[0] };
    return { tipo: grupoGeo(g.tipo), geojson: gj, detalle: g.detalle || '', nota: g.nota || '' };
  }
  function geomDeServidor(g) {
    var gj = g.geojson, c = gj.type === 'Polygon' ? gj.coordinates[0].slice(0, -1) : gj.type === 'Point' ? [gj.coordinates] : gj.coordinates;
    return { id: uuid(), tipo: grupoGeo(g.tipo), coordenadas: c, detalle: g.detalle || '', nota: g.nota || '', precargada: true };
  }

  // ----------------------------------------------------------------
  // Navegación
  // ----------------------------------------------------------------
  function titulo(t, volver) {
    $('#titulo').textContent = t;
    $('#btnVolver').hidden = !volver;
    $('#btnVolver').onclick = volver || null;
  }
  // Franja institucional: solo en instalación, acceso e inicio
  // Franja institucional visible en todas las pantallas: completa en acceso e inicio, compacta en el resto
  function marca(completa) { var m = $('#marca'); if (m) { m.hidden = false; m.classList.toggle('compacta', !completa); } }
  function limpiarVista() {
    marca(false);
    detenerGPS();
    if (S.detenerExtra) { S.detenerExtra(); S.detenerExtra = null; }
    S.alUbicar = null; S.alTipo = null; S.alGPS = null; S.marcarSitio = null; S.refrescarBarra = null; S.mostrarMapa = null; S.marcandoSitio = false;
    document.body.classList.remove('dibujando');
    if (S.mapa) { S.mapa.remove(); S.mapa = null; }
    $('#navpasos').innerHTML = '';
    cerrarModal();
    window.scrollTo(0, 0);
  }
  function actualizarConexion() {
    var p = $('#conexion');
    var pend = S.fichas.filter(function (f) { return f.estado === 'pendiente' || f.estado === 'enviando'; }).length;
    if (navigator.onLine) { p.className = 'pildora'; p.textContent = pend ? 'En línea · ' + pend + ' por enviar' : 'En línea'; }
    else { p.className = 'pildora off'; p.textContent = pend ? 'Sin señal · ' + pend + ' por enviar' : 'Sin señal'; }
  }

  // ----------------------------------------------------------------
  // Modal e información "i"
  // ----------------------------------------------------------------
  function modal(html, alCerrar) {
    $('#modal').innerHTML = '<div class="velo"><div class="modal" role="dialog" aria-modal="true">' + html + '</div></div>';
    var velo = $('#modal .velo');
    velo.addEventListener('click', function (e) { if (e.target === velo) { cerrarModal(); alCerrar && alCerrar(); } });
    return $('#modal .modal');
  }
  function cerrarModal() { $('#modal').innerHTML = ''; }
  function botonInfo(clave) { return '<button type="button" class="btn-i" data-info="' + clave + '" aria-label="Qué significa">i</button>'; }
  function mostrarInfo(clave) {
    var d = DEFINICIONES[clave]; if (!d) return;
    var m = modal('<h2>' + esc(d.titulo) + '</h2><dl>' + d.items.map(function (it) {
      return '<dt>' + esc(it[0]) + '</dt><dd>' + esc(it[1]) + '</dd>';
    }).join('') + '</dl>' + (d.nota ? '<p class="muted">' + esc(d.nota) + '</p>' : '') +
      '<button class="btn primario" style="margin-top:16px" id="mOk">Entendido</button>');
    $('#mOk', m).onclick = cerrarModal;
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-info]');
    if (b) { e.preventDefault(); mostrarInfo(b.getAttribute('data-info')); }
  });
  function confirmar(texto, si, no) {
    return new Promise(function (ok) {
      var m = modal('<h2>' + esc(texto) + '</h2><div class="fila-btn"><button class="btn" id="mNo">' + esc(no || 'Cancelar') + '</button><button class="btn primario" id="mSi">' + esc(si || 'Sí') + '</button></div>');
      $('#mNo', m).onclick = function () { cerrarModal(); ok(false); };
      $('#mSi', m).onclick = function () { cerrarModal(); ok(true); };
    });
  }

  // ----------------------------------------------------------------
  // Instalación obligatoria y acceso
  // ----------------------------------------------------------------
  var promptInstalar = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); promptInstalar = e; if ($('#btnInstalar')) $('#btnInstalar').hidden = false; });
  function estaInstalada() {
    return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true ||
      /[?&]dev=1/.test(location.search);
  }
  function vistaInstalar() {
    limpiarVista(); marca(true); titulo('Instalar la app');
    // iPadOS se presenta como Mac: se reconoce por la pantalla táctil
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    var tIos = '<div class="tarjeta"><h2>En iPhone o iPad</h2><ol>' +
      '<li>Abra este enlace en <b>Safari</b>. Si lo abrió desde WhatsApp, toque los tres puntos o la brújula y elija <b>Abrir en Safari</b>.</li>' +
      '<li>Toque el botón <b>Compartir</b>: el cuadro con la flecha hacia arriba, en la barra de abajo (en iOS reciente puede estar dentro del botón <b>···</b>).</li>' +
      '<li>Baje en la lista y elija <b>Agregar a pantalla de inicio</b>. Si no aparece, toque <b>Editar acciones</b> y agréguela.</li>' +
      '<li>Toque <b>Agregar</b>, arriba a la derecha.</li>' +
      '<li>Cierre Safari y abra la app desde el ícono nuevo <b>Afectaciones GAL</b>.</li></ol></div>';
    var tAnd = '<div class="tarjeta"><h2>En Android</h2>' +
      '<button class="btn primario" id="btnInstalar" ' + (promptInstalar ? '' : 'hidden') + '>Instalar ahora</button>' +
      '<ol><li>Abra este enlace en <b>Chrome</b>.</li><li>Toque el menú <b>⋮</b> del navegador.</li><li>Elija <b>Instalar app</b> o <b>Agregar a pantalla de inicio</b>.</li><li>Abra la app desde el ícono nuevo <b>Afectaciones GAL</b>.</li></ol></div>';
    $('#vista').innerHTML =
      '<div class="aviso alerta">Para registrar afectaciones la app debe estar instalada en la pantalla de inicio. Así abre sin señal y el teléfono no borra las fichas guardadas.</div>' +
      (ios ? tIos + tAnd : tAnd + tIos) +
      '<p class="muted">Abra esta página con señal la primera vez, para que la app quede guardada en el teléfono.</p>';
    var b = $('#btnInstalar');
    if (b) b.onclick = function () { if (promptInstalar) { promptInstalar.prompt(); promptInstalar.userChoice.then(function () { promptInstalar = null; }); } };
  }

  // Acceso: cuenta con correo y clave (registro propio) o código de administrador
  function campoAcc(id, et, tipo, extra) {
    return '<div class="campo"><label for="' + id + '">' + et + '</label><input type="' + (tipo || 'text') + '" id="' + id + '" ' + (extra || '') + '></div>';
  }
  function msgAcc(html, clase) { $('#msg').innerHTML = html ? '<div class="aviso ' + (clase || 'error') + '">' + html + '</div>' : ''; }
  function sinSenal() { if (navigator.onLine) return false; msgAcc('Sin señal. Intente cuando tenga conexión.', 'alerta'); return true; }
  function entrarCon(sesion) {
    S.sesion = sesion; sesion.desde = Date.now();
    return DB.kvSet('sesion', sesion).then(function () { return DB.kvSet('authError', ''); }).then(function () {
      if (sesion.correo && sesion.correo !== 'ADMINISTRADOR') DB.kvSet('ultimoCorreo', sesion.correo);
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
      return Sync.sincronizar();
    }).then(cargarDatos).then(vistaInicio);
  }
  // ----------------------------------------------------------------
  // Ingreso sin señal: tras cada ingreso en línea se guarda en el teléfono una huella de la clave
  // (PBKDF2, nunca la clave). Sin señal, la misma cuenta puede volver a entrar en ese teléfono.
  // ----------------------------------------------------------------
  var MAX_INTENTOS_LOCAL = 5, MIN_BLOQUEO_LOCAL = 15;
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); }
  function huella(secreto, sal) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(secreto), 'PBKDF2', false, ['deriveBits']).then(function (k) {
      return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(sal), iterations: 150000 }, k, 256);
    }).then(hex);
  }
  function claveLocal(cuenta) { return 'accesoLocal:' + String(cuenta || '').trim().toLowerCase(); }
  function recordarAcceso(cuenta, secreto, sesion) {
    if (!secreto || !window.crypto || !crypto.subtle) return Promise.resolve();
    var sal = hex(crypto.getRandomValues(new Uint8Array(16)));
    return huella(secreto, sal).then(function (h) {
      return DB.kvSet(claveLocal(cuenta), { sal: sal, huella: h, sesion: sesion, fecha: Date.now(), intentos: 0, bloqueo: 0 });
    }).catch(function () {});
  }
  function entrarSinSenal(cuenta, secreto, boton) {
    var k = claveLocal(cuenta);
    return DB.kvGet(k).then(function (reg) {
      if (!reg || !window.crypto || !crypto.subtle) {
        throw new Error('Sin señal. Esta cuenta aún no ha ingresado en este teléfono: el primer ingreso necesita conexión. Después podrá entrar sin señal.');
      }
      if (reg.bloqueo && reg.bloqueo > Date.now()) {
        throw new Error('Demasiados intentos sin señal. Espere ' + Math.ceil((reg.bloqueo - Date.now()) / 60000) + ' minuto(s).');
      }
      return huella(secreto, reg.sal).then(function (h) {
        if (h !== reg.huella) {
          reg.intentos = (reg.intentos || 0) + 1;
          if (reg.intentos >= MAX_INTENTOS_LOCAL) { reg.intentos = 0; reg.bloqueo = Date.now() + MIN_BLOQUEO_LOCAL * 60000; }
          return DB.kvSet(k, reg).then(function () {
            throw new Error('Sin señal. La clave no coincide con la del último ingreso en este teléfono.');
          });
        }
        reg.intentos = 0; reg.bloqueo = 0;
        return DB.kvSet(k, reg).then(function () {
          toast('Ingreso sin señal. Las fichas se enviarán cuando haya conexión.');
          return entrarCon(reg.sesion);
        });
      });
    }).catch(function (e) { if (boton) ocupado(boton, false); msgAcc(esc(e.message), 'alerta'); });
  }

  function tratarAcceso(r, correo, secreto) {
    if (!r.ok) throw new Error(r.error);
    if (r.estado === 'HABILITADO') {
      var ses = { tipo: 'usuario', codigo: r.correo, correo: r.correo, nombre: r.nombre, token: r.token };
      return recordarAcceso(r.correo, secreto, ses).then(function () { return entrarCon(ses); });
    }
    if (r.estado === 'PENDIENTE_VERIFICACION') return vistaCodigo(correo, 'verificar', r.mensaje);
    if (r.estado === 'PENDIENTE_APROBACION') {
      limpiarVista(); titulo('Acceso pendiente', function () { vistaAcceso('ingresar'); });
      $('#vista').innerHTML = '<div class="aviso info">' + esc(r.mensaje) + '</div><button class="btn primario" id="volver">Volver a ingresar</button>';
      $('#volver').onclick = function () { vistaAcceso('ingresar'); };
    }
  }
  function ocupado(b, si) { b.disabled = si; if (si) msgAcc('<span class="muted">Procesando…</span>', 'info'); }

  function vistaAcceso(pestana) {
    limpiarVista(); marca(true); titulo('Acceso');
    pestana = pestana || 'ingresar';
    DB.kvGet('ultimoCorreo').then(function (ultimo) {
      var tabs = '<div class="fila-btn" style="margin-bottom:14px">' +
        '<button class="btn' + (pestana === 'ingresar' ? ' primario' : '') + '" data-tab="ingresar">Ingresar</button>' +
        '<button class="btn' + (pestana === 'registro' ? ' primario' : '') + '" data-tab="registro">Registrarme</button></div>';
      var cuerpo;
      if (pestana === 'ingresar') {
        cuerpo = '<div class="tarjeta">' + campoAcc('correo', 'Correo electrónico', 'email', 'autocomplete="username" inputmode="email" value="' + esc(ultimo || '') + '"') +
          campoAcc('clave', 'Clave', 'password', 'autocomplete="current-password"') +
          '<button class="btn primario" id="go">Ingresar</button>' +
          '<button class="btn" id="olvide" style="border:0">Olvidé mi clave</button></div>' +
          '<p style="text-align:center"><button class="btn chico" id="admin" style="border:0;margin:auto">Ingresar con código de administrador</button></p>';
      } else if (pestana === 'registro') {
        cuerpo = '<div class="tarjeta"><p class="muted">Con correo institucional (@gestionderiesgos.gob.ec) el acceso es inmediato al verificar el correo. Con otro correo, el administrador debe aprobarlo.</p>' +
          campoAcc('nombre', 'Nombres y apellidos', 'text', 'autocomplete="name"') +
          campoAcc('correo', 'Correo electrónico', 'email', 'autocomplete="email" inputmode="email"') +
          campoAcc('inst', 'Institución', 'text', 'placeholder="Ej.: SNGR, GAD Santa Cruz, Cuerpo de Bomberos"') +
          campoAcc('clave', 'Clave (mínimo 8 caracteres)', 'password', 'autocomplete="new-password"') +
          campoAcc('clave2', 'Repita la clave', 'password', 'autocomplete="new-password"') +
          '<button class="btn accion" id="go">Crear cuenta</button></div>';
      }
      $('#vista').innerHTML = tabs + cuerpo + '<div id="msg"></div>' +
        (CONFIG.BACKEND_URL ? '' : '<div class="aviso error">La app aún no tiene configurado el servidor. Avise al administrador.</div>');
      $$('[data-tab]').forEach(function (b) { b.onclick = function () { vistaAcceso(b.getAttribute('data-tab')); }; });
      var go = $('#go');
      if (pestana === 'ingresar') {
        $('#olvide').onclick = function () { vistaRecuperar($('#correo').value.trim()); };
        $('#admin').onclick = vistaAdmin;
        go.onclick = function () {
          var correo = $('#correo').value.trim(), clave = $('#clave').value;
          if (!correo || !clave) return msgAcc('Ingrese su correo y su clave.');
          ocupado(go, true);
          if (!navigator.onLine) return entrarSinSenal(correo, clave, go);
          Sync.post({ accion: 'ingresar', correo: correo, clave: clave }, 20000).then(function (r) { return tratarAcceso(r, correo, clave); })
            .catch(function (e) {
              // Señal débil: el teléfono dice estar en línea pero el servidor no responde
              if (e && e.red) return entrarSinSenal(correo, clave, go);
              ocupado(go, false); msgAcc(esc(e.message));
            });
        };
      } else if (pestana === 'registro') {
        go.onclick = function () {
          var d = { nombre: $('#nombre').value.trim(), correo: $('#correo').value.trim(), institucion: $('#inst').value.trim(), clave: $('#clave').value };
          if (!d.nombre || !d.correo || !d.institucion || !d.clave) return msgAcc('Complete todos los campos.');
          if (d.clave.length < 8) return msgAcc('La clave debe tener al menos 8 caracteres.');
          if (d.clave !== $('#clave2').value) return msgAcc('Las claves no coinciden.');
          if (sinSenal()) return;
          ocupado(go, true);
          Sync.post(Object.assign({ accion: 'registrar' }, d)).then(function (r) {
            if (!r.ok) throw new Error(r.error);
            vistaCodigo(r.correo, 'verificar', r.mensaje);
          }).catch(function (e) { ocupado(go, false); msgAcc(esc(e.message)); });
        };
      }
    });
  }

  // Código único de administrador: todos los permisos
  function vistaAdmin() {
    limpiarVista(); marca(true); titulo('Administrador', function () { vistaAcceso('ingresar'); });
    $('#vista').innerHTML = '<div class="tarjeta"><p class="muted">Código único de administrador (hoja Configuración, CODIGO_ADMINISTRADOR).</p>' +
      campoAcc('adm', 'Código de administrador', 'password', 'autocomplete="off" autocapitalize="characters"') +
      '<button class="btn primario" id="go">Ingresar</button></div><div id="msg"></div>';
    $('#go').onclick = function () {
      var c = $('#adm').value.trim().toUpperCase(); if (!c) return;
      ocupado($('#go'), true);
      if (!navigator.onLine) return entrarSinSenal('ADMINISTRADOR', c, $('#go'));
      Sync.post({ accion: 'ingresarAdmin', codigo: c }, 20000).then(function (r) { return tratarAcceso(r, 'ADMINISTRADOR', c); })
        .catch(function (e) {
          if (e && e.red) return entrarSinSenal('ADMINISTRADOR', c, $('#go'));
          ocupado($('#go'), false); msgAcc(esc(e.message));
        });
    };
  }

  // Código de 6 dígitos enviado por correo: verificar el correo o restablecer la clave
  function vistaCodigo(correo, motivo, mensaje) {
    limpiarVista(); titulo(motivo === 'verificar' ? 'Verifique su correo' : 'Nueva clave', function () { vistaAcceso('ingresar'); });
    $('#vista').innerHTML = '<div class="aviso info">' + esc(mensaje || 'Le enviamos un código a ' + correo) + '. Revise también la carpeta de spam.</div>' +
      '<div class="tarjeta">' + campoAcc('cod', 'Código de 6 dígitos', 'text', 'inputmode="numeric" autocomplete="one-time-code" maxlength="6"') +
      (motivo === 'recuperar' ? campoAcc('clave', 'Nueva clave (mínimo 8 caracteres)', 'password', 'autocomplete="new-password"') + campoAcc('clave2', 'Repita la nueva clave', 'password', 'autocomplete="new-password"') : '') +
      '<button class="btn primario" id="go">' + (motivo === 'verificar' ? 'Verificar' : 'Guardar nueva clave') + '</button>' +
      '<button class="btn" id="reenviar" style="border:0">Enviar un código nuevo</button></div><div id="msg"></div>';
    $('#go').onclick = function () {
      var cod = $('#cod').value.trim(); if (cod.length !== 6) return msgAcc('El código tiene 6 dígitos.');
      var cuerpo = { accion: motivo === 'verificar' ? 'verificar' : 'restablecer', correo: correo, codigo: cod };
      if (motivo === 'recuperar') {
        cuerpo.clave = $('#clave').value;
        if (cuerpo.clave.length < 8) return msgAcc('La clave debe tener al menos 8 caracteres.');
        if (cuerpo.clave !== $('#clave2').value) return msgAcc('Las claves no coinciden.');
      }
      if (sinSenal()) return;
      ocupado($('#go'), true);
      Sync.post(cuerpo).then(function (r) { return tratarAcceso(r, correo); }).catch(function (e) { ocupado($('#go'), false); msgAcc(esc(e.message)); });
    };
    $('#reenviar').onclick = function () {
      if (sinSenal()) return;
      Sync.post({ accion: motivo === 'verificar' ? 'reenviarCodigo' : 'recuperar', correo: correo }).then(function (r) { msgAcc(esc(r.mensaje || r.error), r.ok ? 'ok' : 'error'); });
    };
  }
  function vistaRecuperar(correo) {
    limpiarVista(); titulo('Olvidé mi clave', function () { vistaAcceso('ingresar'); });
    $('#vista').innerHTML = '<div class="tarjeta"><p>Le enviaremos un código a su correo para crear una clave nueva.</p>' +
      campoAcc('correo', 'Correo electrónico', 'email', 'inputmode="email" value="' + esc(correo || '') + '"') +
      '<button class="btn primario" id="go">Enviar código</button></div><div id="msg"></div>';
    $('#go').onclick = function () {
      var c = $('#correo').value.trim(); if (!c) return msgAcc('Ingrese su correo.');
      if (sinSenal()) return;
      ocupado($('#go'), true);
      Sync.post({ accion: 'recuperar', correo: c }).then(function (r) {
        if (!r.ok) throw new Error(r.error);
        vistaCodigo(c.toLowerCase(), 'recuperar', r.mensaje);
      }).catch(function (e) { ocupado($('#go'), false); msgAcc(esc(e.message)); });
    };
  }

  // ----------------------------------------------------------------
  // Inicio
  // ----------------------------------------------------------------
  function vistaInicio() {
    limpiarVista(); marca(true); marcar('inicio'); S.pila = []; titulo('Registro de afectaciones');
    var ahora = Date.now();
    var borr = S.fichas.filter(function (f) { return f.estado === 'borrador'; });
    var pend = S.fichas.filter(function (f) { return f.estado === 'pendiente' || f.estado === 'enviando'; });
    var errs = S.fichas.filter(function (f) { return f.estado === 'error'; });
    var fotosPend = 0;
    var vieja = !S.eventosHora || (ahora - S.eventosHora) > CONFIG.LISTA_VIEJA_H * 3600e3;
    var borrViejo = borr.some(function (f) { return ahora - msDe(f.actualizada) > CONFIG.BORRADOR_RECORDATORIO_H * 3600e3; });
    var pendViejo = pend.some(function (f) { return ahora - msDe(f.encolada) > CONFIG.RESPALDO_SUGERIDO_H * 3600e3; });
    var rechazos = S.eventos.filter(function (e) { return e.cierre === 'RECHAZADO'; });

    var h = '';
    if (S.authError) h += '<div class="aviso error">' + esc(S.authError) + ' Sus fichas siguen guardadas en el teléfono.<button class="btn chico" id="reIngresar">Volver a ingresar</button></div>';
    if (errs.length) h += '<div class="aviso error">' + errs.length + ' ficha(s) con error que requieren su revisión.<button class="btn chico" data-ir="mis">Revisar</button></div>';
    if (borrViejo) h += '<div class="aviso alerta">Tiene borradores sin enviar desde hace más de ' + CONFIG.BORRADOR_RECORDATORIO_H + ' hora. Esa información no llega al COE hasta que la envíe.<button class="btn chico" data-ir="mis">Ver borradores</button></div>';
    if (pendViejo) h += '<div class="aviso alerta">Hay fichas sin enviar desde hace más de ' + CONFIG.RESPALDO_SUGERIDO_H + ' horas. Exporte un respaldo a otro teléfono por si este se pierde o se daña.<button class="btn chico" data-ir="respaldo">Exportar respaldo</button></div>';
    if (rechazos.length) h += '<div class="aviso info">El administrador rechazó el cierre de ' + rechazos.length + ' evento(s). Revise el motivo en la lista de eventos.</div>';

    h += '<div class="estado-grid">' +
      '<div class="dato' + (vieja ? ' rojo' : '') + '"><div class="rot">Eventos actualizados</div><div style="font-weight:750">' + hace(S.eventosHora) + '</div>' +
      (vieja ? '<div class="rot">Puede haber eventos que no ve</div>' : '') + '</div>' +
      '<div class="dato"><div class="num">' + pend.length + '</div><div class="rot">Fichas por enviar</div></div>' +
      '<div class="dato"><div class="num">' + borr.length + '</div><div class="rot">Borradores</div></div>' +
      '<div class="dato"><div class="num">' + listaEventos().filter(function (e) { return e.estado !== 'Cerrado'; }).length + '</div><div class="rot">Eventos vigentes</div></div></div>';

    h += '<button class="btn accion" id="nuevo">＋ Registrar evento nuevo</button>' +
      '<button class="btn primario" id="actualizar">Actualizar un evento</button>' +
      '<button class="btn" id="enviarYa"' + (pend.length ? '' : ' disabled') + '>Enviar ahora</button>' +
      '<button class="btn" data-ir="mis">Mis fichas</button>' +
      '<div class="tarjeta" style="margin-top:14px"><h2>Herramientas</h2>' +
      '<button class="btn" data-ir="mapaoff">Preparar mapa sin conexión</button>' +
      '<button class="btn" data-ir="respaldo">Respaldo entre teléfonos</button>' +
      '<p class="muted" style="margin-top:12px">Sesión: <b>' + esc(S.sesion.nombre || '') + '</b> (' + esc(S.sesion.codigo) + ')</p>' +
      '<button class="btn peligro chico" id="salir">Cerrar sesión</button></div>';
    $('#vista').innerHTML = h;

    $('#nuevo').onclick = function () { nuevaFicha('INICIAL'); };
    if ($('#reIngresar')) $('#reIngresar').onclick = function () { DB.kvSet('sesion', null).then(function () { S.sesion = null; vistaAcceso('ingresar'); }); };
    $('#actualizar').onclick = vistaElegirEvento;
    $('#enviarYa').onclick = function () { enviarAhora(); };
    $('#salir').onclick = function () {
      var hay = S.fichas.some(function (f) { return f.estado !== 'enviada'; });
      confirmar(hay ? 'Hay fichas sin enviar. Se conservarán en el teléfono. ¿Cerrar sesión?' : '¿Cerrar sesión?', 'Cerrar sesión').then(function (ok) {
        if (!ok) return;
        if (S.sesion.token && navigator.onLine) Sync.post(Sync.cred(S.sesion, { accion: 'cerrarSesion' })).catch(function () {});
        DB.kvSet('sesion', null).then(function () { S.sesion = null; vistaAcceso(); });
      });
    };
    $$('[data-ir]').forEach(function (b) {
      b.onclick = function () {
        var d = b.getAttribute('data-ir');
        if (d === 'mis') vistaMisFichas(); else if (d === 'respaldo') vistaRespaldo(); else if (d === 'mapaoff') vistaMapaOffline();
      };
    });
    actualizarConexion();
  }

  function enviarAhora(silencioso) {
    if (!navigator.onLine) { if (!silencioso) toast('Sin señal. Se enviará cuando haya conexión.'); return Promise.resolve(); }
    if (!silencioso) toast('Enviando…');
    return Sync.sincronizar().then(function (r) {
      if (r && r.ocupado) reintentarLuego();
      return cargarDatos().then(function () {
        actualizarConexion();
        if (!silencioso) {
          if (r.ok) toast(r.enviadas || r.fotos ? 'Enviado: ' + r.enviadas + ' ficha(s), ' + r.fotos + ' foto(s)' + (r.errores ? '. ' + r.errores + ' con error' : '') : 'Todo está al día');
          else toast(r.motivo || 'No se pudo enviar');
        }
        if (vistaActual === 'inicio') vistaInicio();
        if (vistaActual === 'mis') vistaMisFichas();
      });
    });
  }
  // Reintento escalonado: cada teléfono espera un tiempo distinto para no llegar todos al mismo segundo
  var reintentoProgramado = null;
  function reintentarLuego(minSeg, maxSeg) {
    if (reintentoProgramado) return;
    var ms = ((minSeg || 20) + Math.random() * ((maxSeg || 60) - (minSeg || 20))) * 1000;
    reintentoProgramado = setTimeout(function () { reintentoProgramado = null; if (S.sesion && navigator.onLine) enviarAhora(true); }, ms);
  }
  var vistaActual = '';
  function marcar(v) { vistaActual = v; }

  // ----------------------------------------------------------------
  // Elegir evento para actualizar
  // ----------------------------------------------------------------
  var ultimaPos = null;
  function vistaElegirEvento() {
    limpiarVista(); marcar('elegir'); titulo('Actualizar un evento', vistaInicio);
    var eventos = listaEventos().filter(function (e) { return e.estado !== 'Cerrado'; });
    function pintar() {
      eventos.forEach(function (e) { e._d = ultimaPos ? distancia(ultimaPos.lat, ultimaPos.lon, e.lat, e.lon) : null; });
      eventos.sort(function (a, b) {
        if (a._d != null && b._d != null) return a._d - b._d;
        return msDe(b.ultima_obs) - msDe(a.ultima_obs);
      });
      $('#lista').innerHTML = eventos.length ? eventos.map(itemEvento).join('') : '<p class="muted">No hay eventos vigentes descargados en este teléfono.</p>';
      $$('#lista .item').forEach(function (b) {
        b.onclick = function () { var e = eventos.find(function (x) { return x.id_evento === b.getAttribute('data-id'); }); nuevaFicha('ACTUALIZACION', e); };
      });
    }
    $('#vista').innerHTML = '<p class="muted" id="posMsg">Buscando su ubicación para ordenar por cercanía…</p>' +
      '<div class="fila-btn" style="margin-bottom:12px"><button class="btn chico" id="verMapa">Ver en el mapa</button></div>' +
      '<div id="mapaEv" class="mapa chico" hidden></div><div id="lista"></div>';
    pintar();
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(function (p) {
        ultimaPos = { lat: p.coords.latitude, lon: p.coords.longitude };
        $('#posMsg') && ($('#posMsg').textContent = 'Ordenados por distancia a su ubicación.');
        pintar();
      }, function () { $('#posMsg') && ($('#posMsg').textContent = 'Sin ubicación: ordenados por la visita más reciente.'); }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
    }
    $('#verMapa').onclick = function () {
      var d = $('#mapaEv'); d.hidden = !d.hidden;
      if (!d.hidden && !S.mapa) {
        S.mapa = crearMapa(d);
        var grupo = L.featureGroup().addTo(S.mapa);
        eventos.forEach(function (e) {
          L.circleMarker([e.lat, e.lon], { radius: 10, color: '#fff', weight: 2, fillColor: COLOR_ESTADO[e.estado] || '#555', fillOpacity: 1 })
            .bindPopup('<b>' + esc(e.sector || e.parroquia) + '</b><br>' + esc(e.estado) + '<br><button class="btn chico primario" data-sel="' + esc(e.id_evento) + '">Actualizar este</button>')
            .addTo(grupo);
        });
        if (ultimaPos) L.circleMarker([ultimaPos.lat, ultimaPos.lon], { radius: 7, color: '#013254', fillColor: '#60a5fa', fillOpacity: 1 }).addTo(S.mapa);
        if (eventos.length) S.mapa.fitBounds(grupo.getBounds().pad(0.3), { maxZoom: 17 });
        agregarLeyenda(S.mapa);
        S.mapa.on('popupopen', function (ev) {
          var b = ev.popup.getElement().querySelector('[data-sel]');
          if (b) b.onclick = function () { nuevaFicha('ACTUALIZACION', eventos.find(function (x) { return x.id_evento === b.getAttribute('data-sel'); })); };
        });
      }
    };
  }
  function itemEvento(e) {
    var chips = '<span class="chip">' + esc(e.estado) + '</span>';
    if (e._d != null) chips += '<span class="chip azul">a ' + metros(e._d) + '</span>';
    if (e.local) chips += '<span class="chip amb">Solo en este teléfono</span>';
    if (e.posible_duplicado) chips += '<span class="chip amb">Posible duplicado</span>';
    if (e.cierre === 'SOLICITADO') chips += '<span class="chip azul">Cierre solicitado</span>';
    if (e.cierre === 'RECHAZADO') chips += '<span class="chip rojo">Cierre rechazado: ' + esc(e.rechazo_cierre) + '</span>';
    return '<button class="item ' + esc(e.estado) + '" data-id="' + esc(e.id_evento) + '"><div class="t">' + esc(e.sector || 'Sin sector') + '</div>' +
      '<div class="s">' + esc(e.parroquia) + ', ' + esc(e.canton) + ' · última visita ' + fechaLegible(e.ultima_obs) + (e.tecnico_ultima ? ' por ' + esc(e.tecnico_ultima) : '') + '</div>' + chips + '</button>';
  }

  // ----------------------------------------------------------------
  // Fichas: creación y guardado
  // ----------------------------------------------------------------
  function nuevaFicha(tipo, evento, origen) {
    var f = {
      id_visita: uuid(), tipo: tipo, estado: 'borrador', autor: S.sesion.codigo,
      creada: ahoraISO(), actualizada: ahoraISO(), fecha_observacion: ahoraISO(), paso: 1, pasos6: true,
      valores: clon(VACIO), ubicacion: null, geometrias: [], evento_vinculado: '', base: null
    };
    if (tipo === 'INICIAL') {
      f.id_evento = idEvento();
    } else if (tipo === 'ACTUALIZACION') {
      f.id_evento = evento.id_evento;
      f.valores = Object.assign(clon(VACIO), clon(evento.valores || {}));
      f.valores['Solicitud de Cierre'] = ''; f.valores['Justificación de Baja'] = ''; f.valores['Descripción'] = '';
      f.valores['Cantón'] = evento.canton; f.valores['Parroquia'] = evento.parroquia; f.valores['Sector'] = evento.sector;
      f.valores['Provincia'] = evento.provincia || ''; f.valores['Código Parroquia'] = evento.cod_parroquia || '';
      f.valores['Tipo de Evento'] = evento.tipo_evento || 'Inundación';
      if (CATALOGOS['Estado del Evento'].indexOf(f.valores['Estado del Evento']) < 0) f.valores['Estado del Evento'] = '';
      f.base = clon(f.valores);
      f.ubicacion = { lat: evento.lat, lon: evento.lon, precision: null, metodo: evento.metodo || 'GPS', delEvento: true };
      f.geometrias = (evento.geometrias || []).map(geomDeServidor);
      f.geoBase = firmasGeo(f.geometrias);
      f.evento_ref = { sector: evento.sector, estado: evento.estado, cierre: evento.cierre, rechazo: evento.rechazo_cierre };
    } else if (tipo === 'CORRECCION') {
      f.id_evento = origen.id_evento_servidor || origen.id_evento;
      f.corrige_visita = origen.id_visita;
      f.tipo_original = origen.tipo;
      f.valores = clon(origen.valores);
      f.base = clon(origen.valores);
      f.ubicacion = clon(origen.ubicacion);
      f.ubicacion_base = clon(origen.ubicacion);
      f.geometrias = clon(origen.geometrias || []);
      f.geometrias.forEach(function (g) { g.tipo = grupoGeo(g.tipo); });
      f.geometrias_base = JSON.stringify(firmasGeo(f.geometrias));
      f.geoBase = firmasGeo(f.geometrias);
    }
    S.ficha = f; S.paso = 1;
    guardar().then(function () { vistaPaso(1); });
  }
  var guardando = Promise.resolve();
  function guardar() {
    var f = S.ficha; if (!f) return Promise.resolve();
    f.actualizada = ahoraISO(); f.paso = S.paso;
    guardando = guardando.then(function () { return DB.put('fichas', clon(f)); }).then(function () {
      var i = S.fichas.findIndex(function (x) { return x.id_visita === f.id_visita; });
      if (i >= 0) S.fichas[i] = clon(f); else S.fichas.push(clon(f));
    });
    return guardando;
  }
  function abrirFicha(f, paso) {
    S.ficha = clon(f);
    if (S.ficha.estado === 'pendiente' || S.ficha.estado === 'error') S.ficha.estado = 'borrador'; // sale de la cola mientras se edita
    if (!S.ficha.pasos6) { S.ficha.pasos6 = true; if (S.ficha.paso === 6) S.ficha.paso = 1; else if (S.ficha.paso === 7) S.ficha.paso = 6; }
    S.paso = Math.min(Math.max(paso || S.ficha.paso || 1, 1), PASOS.length);
    guardar().then(function () { vistaPaso(S.paso); });
  }

  // ----------------------------------------------------------------
  // Asistente de pasos
  // ----------------------------------------------------------------
  var PASOS = [
    { t: 'Ubicación y zonas afectadas', f: pasoUbicacionZonas },
    { t: 'Evento', f: pasoEvento },
    { t: 'Personas y viviendas', f: pasoPersonas },
    { t: 'Servicios e infraestructura', f: pasoServicios },
    { t: 'Necesidades inmediatas', f: pasoMedios },
    { t: 'Fotos y envío', f: pasoEnvio }
  ];
  var PASO_ENVIO = 6;
  function nombreTipo(f) {
    return f.tipo === 'INICIAL' ? 'Evento nuevo' : f.tipo === 'ACTUALIZACION' ? 'Actualización' : 'Corrección';
  }
  function vistaPaso(n) {
    limpiarVista(); marcar('ficha');
    S.paso = n;
    var f = S.ficha;
    titulo(nombreTipo(f) + ' · ' + n + '/' + PASOS.length, function () { guardar().then(vistaInicio); toast('Borrador guardado'); });
    var prog = '<div class="progreso">' + PASOS.map(function (p, i) { return '<span class="' + (i < n ? 'hecho' : '') + '"></span>'; }).join('') + '</div>';
    var cab = '';
    if (f.tipo !== 'INICIAL') {
      cab = '<div class="aviso info">' + (f.tipo === 'ACTUALIZACION' ? 'Actualiza el evento' : 'Corrige su visita del evento') + ' <b>' + esc(f.valores['Sector'] || f.id_evento) + '</b>. ' +
        (f.tipo === 'ACTUALIZACION' ? 'Los valores vienen de la última visita: cambie solo lo que cambió.' : 'Cambie solo los datos que estaban errados.') + '</div>';
      if (f.evento_ref && f.evento_ref.cierre === 'RECHAZADO') cab += '<div class="aviso alerta">El administrador rechazó el cierre: ' + esc(f.evento_ref.rechazo) + '.</div>';
    }
    $('#vista').innerHTML = prog + '<h2 class="paso-titulo">' + PASOS[n - 1].t + '</h2>' + cab + '<div id="cuerpo"></div>';
    PASOS[n - 1].f($('#cuerpo'));
    $('#navpasos').innerHTML = '<div class="navpasos">' +
      (n > 1 ? '<button class="btn" id="ant">‹ Atrás</button>' : '<button class="btn" id="ant">Salir</button>') +
      (n < PASOS.length ? '<button class="btn primario" id="sig">Siguiente ›</button>' : '') + '</div>';
    $('#ant').onclick = function () { guardar(); if (n > 1) vistaPaso(n - 1); else { toast('Borrador guardado'); vistaInicio(); } };
    if ($('#sig')) $('#sig').onclick = function () { guardar(); vistaPaso(n + 1); };
  }
  function cambiar(campo, valor) {
    S.ficha.valores[campo] = valor;
    guardar();
  }

  // Botones de opción única (toque de nuevo para quitar)
  function campoOpciones(campo, opciones, etiqueta, extra) {
    extra = extra || {};
    var v = S.ficha.valores[campo];
    return '<div class="campo" data-campo="' + esc(campo) + '"><div class="etq">' + esc(etiqueta || campo) +
      (extra.oblig ? ' <span class="oblig">*</span>' : '') + (extra.info ? botonInfo(extra.info) : '') + '</div>' +
      '<div class="opciones' + (extra.una ? ' una' : '') + '">' + opciones.map(function (o) {
        return '<button type="button" class="op' + (v === o ? ' sel' : '') + '" data-v="' + esc(o) + '">' + esc(o) + '</button>';
      }).join('') + '</div></div>';
  }
  function campoMulti(campo, opciones, etiqueta) {
    var v = S.ficha.valores[campo] || [];
    return '<div class="campo" data-multi="' + esc(campo) + '"><div class="etq">' + esc(etiqueta || campo) + '</div><div class="opciones">' +
      opciones.map(function (o) { return '<button type="button" class="op' + (v.indexOf(o) >= 0 ? ' sel' : '') + '" data-v="' + esc(o) + '">' + esc(o) + '</button>'; }).join('') + '</div></div>';
  }
  function enlazarOpciones(raiz, alCambiar) {
    $$('[data-campo] .op', raiz).forEach(function (b) {
      b.onclick = function () {
        var cont = b.closest('[data-campo]'), campo = cont.getAttribute('data-campo'), v = b.getAttribute('data-v');
        var nuevo = S.ficha.valores[campo] === v ? '' : v;
        cambiar(campo, nuevo);
        $$('.op', cont).forEach(function (x) { x.classList.toggle('sel', x.getAttribute('data-v') === nuevo); });
        alCambiar && alCambiar(campo, nuevo);
      };
    });
    $$('[data-multi] .op', raiz).forEach(function (b) {
      b.onclick = function () {
        var cont = b.closest('[data-multi]'), campo = cont.getAttribute('data-multi'), v = b.getAttribute('data-v');
        var lista = (S.ficha.valores[campo] || []).slice();
        var i = lista.indexOf(v);
        if (i >= 0) lista.splice(i, 1);
        else if (v === 'Ninguna') lista = ['Ninguna'];
        else { lista = lista.filter(function (x) { return x !== 'Ninguna'; }); lista.push(v); }
        cambiar(campo, lista);
        $$('.op', cont).forEach(function (x) { x.classList.toggle('sel', lista.indexOf(x.getAttribute('data-v')) >= 0); });
      };
    });
  }

  // Contador con botones + y −, "sin dato" y "Ninguno"
  function contador(campo, opts) {
    opts = opts || {};
    var v = S.ficha.valores[campo];
    var oblig = CIFRAS_OBLIGATORIAS.indexOf(campo) >= 0;
    var previo = S.ficha.base && S.ficha.base[campo] !== '' && S.ficha.base[campo] != null ? S.ficha.base[campo] : null;
    return '<div class="contador' + (oblig && v === '' ? ' falta' : '') + '" data-cont="' + esc(campo) + '" data-paso="' + (opts.paso || 1) + '">' +
      '<div class="cab"><span>' + esc(ETIQUETAS[campo] || campo) + (oblig ? ' <span class="oblig">*</span>' : '') + '</span>' +
      (previo != null && S.ficha.tipo === 'ACTUALIZACION' ? '<span class="previo">antes: ' + String(previo).replace('.', ',') + '</span>' : '') + '</div>' +
      '<div class="fila"><button type="button" class="menos" aria-label="Restar">−</button>' +
      '<button type="button" class="valor' + (v === '' ? ' sindato' : '') + '">' + (v === '' ? 'Sin dato' : String(v).replace('.', ',')) + '</button>' +
      '<button type="button" class="mas" aria-label="Sumar">+</button></div>' +
      '<div class="extras"><button type="button" class="ninguno' + (v === 0 ? ' sel' : '') + '">Ninguno</button>' +
      (opts.paso === 0.5 ? '' : '<button type="button" data-suma="5">+5</button><button type="button" data-suma="10">+10</button>') +
      '<button type="button" class="borrar">Sin dato</button></div></div>';
  }
  var GRAVES = ['Personas Fallecidas', 'Personas Desaparecidas'];
  function enlazarContadores(raiz, alCambiar) {
    $$('[data-cont]', raiz).forEach(function (c) {
      var campo = c.getAttribute('data-cont'), paso = Number(c.getAttribute('data-paso'));
      function poner(n) {
        if (n !== '' && n < 0) n = 0;
        if (n !== '' && paso === 0.5) n = Math.round(n * 2) / 2;
        var antes = S.ficha.valores[campo];
        var aplicar = function () {
          cambiar(campo, n);
          var vb = $('.valor', c);
          vb.textContent = n === '' ? 'Sin dato' : String(n).replace('.', ',');
          vb.classList.toggle('sindato', n === '');
          $('.ninguno', c).classList.toggle('sel', n === 0);
          c.classList.toggle('falta', CIFRAS_OBLIGATORIAS.indexOf(campo) >= 0 && n === '');
          alCambiar && alCambiar(campo, n);
        };
        if (GRAVES.indexOf(campo) >= 0 && n > 0 && !(antes > 0)) {
          confirmar('¿Confirma que hay ' + (campo === 'Personas Fallecidas' ? 'personas fallecidas' : 'personas desaparecidas') + ' en este sitio?', 'Sí, confirmo').then(function (ok) { if (ok) aplicar(); });
        } else aplicar();
      }
      function actual() { var v = S.ficha.valores[campo]; return v === '' ? null : Number(v); }
      $('.mas', c).onclick = function () { var a = actual(); poner(a == null ? (paso === 0.5 ? 0.5 : 1) : a + paso); };
      $('.menos', c).onclick = function () { var a = actual(); if (a == null) return; poner(Math.max(0, a - paso)); };
      $('.ninguno', c).onclick = function () { poner(0); };
      $('.borrar', c).onclick = function () { poner(''); };
      $$('[data-suma]', c).forEach(function (b) { b.onclick = function () { var a = actual() || 0; poner(a + Number(b.getAttribute('data-suma'))); }; });
      $('.valor', c).onclick = function () {
        var m = modal('<h2>' + esc(ETIQUETAS[campo] || campo) + '</h2><input type="number" inputmode="' + (paso === 0.5 ? 'decimal' : 'numeric') + '" min="0" step="' + paso + '" id="mNum" value="' + (actual() == null ? '' : actual()) + '">' +
          '<div class="fila-btn" style="margin-top:14px"><button class="btn" id="mNo">Cancelar</button><button class="btn primario" id="mSi">Aceptar</button></div>');
        var inp = $('#mNum', m); setTimeout(function () { inp.focus(); }, 50);
        $('#mNo', m).onclick = cerrarModal;
        $('#mSi', m).onclick = function () {
          var t = inp.value.replace(',', '.').trim();
          cerrarModal();
          if (t === '') return poner('');
          var n = Number(t); if (isNaN(n) || n < 0) return toast('Número no válido');
          if (paso !== 0.5) n = Math.round(n);
          poner(n);
        };
      };
    });
  }

  // ---------------- Paso 1: Ubicación ----------------
  // Listas territoriales desde DPA (datos/dpa.js): provincia > cantón > parroquia, con códigos CONALI
  function opcionesDPA(dic, sel, vacio) {
    return '<option value="">' + vacio + '</option>' + Object.keys(dic).sort(function (a, b) { return nombreDPA(dic[a]).localeCompare(nombreDPA(dic[b]), 'es'); })
      .map(function (k) { return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + esc(nombreDPA(dic[k])) + '</option>'; }).join('');
  }
  function nombreDPA(x) { return typeof x === 'string' ? x : x.n; }
  function fijarParroquia(cod) {
    var v = S.ficha.valores;
    if (!cod) { v['Código Parroquia'] = ''; v['Parroquia'] = ''; return; }
    var pv = DPA[cod.slice(0, 2)], ca = pv && pv.c[cod.slice(0, 4)];
    if (!ca || !ca.p[cod]) return;
    v['Provincia'] = pv.n; v['Cantón'] = ca.n; v['Parroquia'] = ca.p[cod]; v['Código Parroquia'] = cod;
  }
  function codProvincia() { var c = S.ficha.valores['Código Parroquia']; return c ? c.slice(0, 2) : (S.selProv || ''); }
  function codCanton() { var c = S.ficha.valores['Código Parroquia']; return c ? c.slice(0, 4) : (S.selCant || ''); }
  function pintarSelectsDPA() {
    if (!$('#selProv')) return;
    var pv = codProvincia(), ca = codCanton(), pa = S.ficha.valores['Código Parroquia'];
    $('#selProv').innerHTML = opcionesDPA(DPA, pv, 'Elegir…');
    $('#selCanton').innerHTML = pv ? opcionesDPA(DPA[pv].c, ca, 'Elegir…') : '<option value="">Primero elija la provincia</option>';
    $('#selParroquia').innerHTML = ca && pv ? opcionesDPA(DPA[pv].c[ca].p, pa, 'Elegir…') : '<option value="">Primero elija el cantón</option>';
  }

  function pasoUbicacion(cuerpo, abajo) {
    var f = S.ficha;
    var h = '';
    if (f.tipo === 'ACTUALIZACION') {
      cuerpo.innerHTML = '<div class="tarjeta"><span class="chip">' + esc(f.valores['Tipo de Evento'] || 'Inundación') + '</span><br><b>' + esc(f.valores['Parroquia']) + ', ' + esc(f.valores['Cantón']) + (f.valores['Provincia'] ? ', ' + esc(f.valores['Provincia']) : '') + '</b><br><span class="muted">La ubicación del evento ya está registrada.</span></div>';
      abajo.innerHTML = campoTexto('Sector', 'Sector o barrio', 'Ej.: Barrio Las Ninfas, calle principal');
      enlazarTexto(abajo);
      return;
    }
    if (f.tipo === 'INICIAL') {
      h += '<div class="campo" data-campo="Tipo de Evento"><div class="etq">Tipo de evento <span class="oblig">*</span></div><div class="opciones">' +
        CATALOGOS['Tipo de Evento'].map(function (o) { return '<button type="button" class="op' + (f.valores['Tipo de Evento'] === o ? ' sel' : '') + '" data-tipoev="' + esc(o) + '">' + esc(o) + '</button>'; }).join('') + '</div></div>';
    }
    cuerpo.innerHTML = h;
    abajo.innerHTML = '<div class="fila-dpa">' +
      '<div class="campo"><div class="etq">Provincia <span class="oblig">*</span></div><select id="selProv"></select></div>' +
      '<div class="campo"><div class="etq">Cantón <span class="oblig">*</span></div><select id="selCanton"></select></div>' +
      '<div class="campo"><div class="etq">Parroquia <span class="oblig">*</span></div><select id="selParroquia"></select></div></div>' +
      '<p class="muted" id="msgParr"></p>' +
      campoTexto('Sector', 'Sector o barrio', 'Ej.: Barrio La Merced, calle principal', true);
    enlazarTexto(abajo);
    $$('[data-tipoev]', cuerpo).forEach(function (b) {
      b.onclick = function () {
        var t = b.getAttribute('data-tipoev'), antes = f.valores['Tipo de Evento'];
        var hay = f.geometrias.some(function (g) { return formaGeo(g.tipo) !== 'poligono'; });
        var seguir = t === 'Movimiento en masa' && hay ? confirmar('En movimiento en masa solo se dibuja el área afectada. Se quitarán los tramos, cauces y puntos dibujados.', 'Cambiar') : Promise.resolve(true);
        seguir.then(function (ok) {
          if (!ok) return;
          f.valores['Tipo de Evento'] = t;
          if (t === 'Movimiento en masa') {
            f.geometrias = f.geometrias.filter(function (g) { return formaGeo(g.tipo) === 'poligono'; });
            ['Origen', 'Nivel del Agua', 'Tendencia del Agua'].forEach(function (c) { f.valores[c] = ''; });
          }
          guardar();
          $$('[data-tipoev]', cuerpo).forEach(function (x) { x.classList.toggle('sel', x === b); });
          if (S.mostrarMapa) S.mostrarMapa();
          if (antes !== t && S.alTipo) S.alTipo();
        });
      };
    });
    S.selProv = codProvincia(); S.selCant = codCanton();
    pintarSelectsDPA();
    $('#selProv').onchange = function () { S.selProv = this.value; S.selCant = ''; fijarParroquia(''); f.valores['Cantón'] = ''; f.valores['Provincia'] = this.value ? DPA[this.value].n : ''; guardar(); pintarSelectsDPA(); };
    $('#selCanton').onchange = function () { S.selCant = this.value; fijarParroquia(''); f.valores['Cantón'] = this.value ? DPA[S.selProv].c[this.value].n : ''; guardar(); pintarSelectsDPA(); };
    $('#selParroquia').onchange = function () { fijarParroquia(this.value); guardar(); };
    pintarGPS();
    if (f.tipo === 'INICIAL' && !(f.ubicacion && f.ubicacion.aceptada)) iniciarGPS();
  }

  function campoTexto(campo, etiqueta, ph, sinAyuda) {
    return '<div class="campo"><label for="t-' + esc(campo) + '">' + esc(etiqueta) + '</label>' +
      '<input type="text" id="t-' + esc(campo) + '" data-texto="' + esc(campo) + '" value="' + esc(S.ficha.valores[campo]) + '" placeholder="' + esc(ph || '') + '" autocomplete="off">' +
      (sinAyuda ? '' : '<p class="muted">Puede dictar con el micrófono del teclado.</p>') + '</div>';
  }
  function enlazarTexto(raiz) {
    $$('[data-texto]', raiz).forEach(function (i) {
      i.oninput = function () { S.ficha.valores[i.getAttribute('data-texto')] = i.value; clearTimeout(i._t); i._t = setTimeout(guardar, 400); };
    });
  }

  function detenerGPS() {
    if (S.gpsWatch != null) { navigator.geolocation.clearWatch(S.gpsWatch); S.gpsWatch = null; }
    clearInterval(S.gpsReloj); S.gpsReloj = null;
  }
  function iniciarGPS() {
    detenerGPS();
    if (!navigator.geolocation) { S.gpsEstado = { error: 'Este teléfono no permite ubicación' }; pintarGPS(); return; }
    S.gpsEstado = { inicio: Date.now(), mejor: null };
    S.gpsWatch = navigator.geolocation.watchPosition(function (p) {
      var c = p.coords, e = S.gpsEstado;
      if (!e.mejor || c.accuracy < e.mejor.precision) e.mejor = { lat: c.latitude, lon: c.longitude, precision: c.accuracy };
      e.ultima = c.accuracy;
      if (c.accuracy <= CONFIG.PRECISION_ACEPTABLE_M) aceptarUbicacion(e.mejor, 'GPS');
      else pintarGPS();
    }, function (err) {
      S.gpsEstado.error = err.code === 1 ? 'Sin permiso de ubicación. Actívelo en los ajustes del teléfono.' : 'Buscando señal satelital…';
      pintarGPS();
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 120000 });
    S.gpsReloj = setInterval(pintarGPS, 1000);
  }
  function aceptarUbicacion(pos, metodo) {
    detenerGPS();
    var f = S.ficha;
    f.ubicacion = { lat: pos.lat, lon: pos.lon, precision: metodo === 'GPS' ? pos.precision : null, metodo: metodo, aceptada: true };
    detectarTerritorio(pos.lat, pos.lon);
    guardar();
    pintarGPS();
    if (S.alUbicar) S.alUbicar();
    if (f.tipo === 'INICIAL') revisarCercanos();
  }
  // Estado del GPS en una franja sobre el mapa de la ficha; el sitio se marca o se mueve en ese mismo mapa
  function pintarGPS() {
    var d = $('#gps'); if (!d) return;
    var f = S.ficha, u = f.ubicacion, e = S.gpsEstado || {};
    if (S.alGPS) S.alGPS();
    if (u && u.aceptada) {
      d.innerHTML = '<div class="gps bueno compacto"><span><b>✓ Sitio</b> · ' + (u.metodo === 'GPS' ? 'GPS ' + Math.round(u.precision) + ' m' : 'marcado en el mapa') +
        ' · <span class="muted">' + u.lat.toFixed(5) + ', ' + u.lon.toFixed(5) + '</span></span>' +
        (u.metodo === 'GPS' ? '' : '<button class="enlace" id="gpsOtra">Usar GPS</button>') + '</div>';
      if ($('#gpsOtra')) $('#gpsOtra').onclick = function () { f.ubicacion = null; guardar(); iniciarGPS(); pintarGPS(); if (S.alUbicar) S.alUbicar(); };
      if (S.refrescarBarra) S.refrescarBarra();
      return;
    }
    if (S.marcandoSitio) { d.innerHTML = ''; return; }
    var seg = e.inicio ? Math.round((Date.now() - e.inicio) / 1000) : 0;
    var prec = e.mejor ? Math.round(e.mejor.precision) : null;
    var largo = seg >= CONFIG.ESPERA_GPS_S || e.error;
    var h = '<div class="gps compacto ' + (prec != null || e.error ? 'malo' : '') + '"><span><b>Buscando GPS: ' + (prec != null ? prec + ' m' : '…') + '</b> · ' + seg + ' s · ' +
      '<span class="muted">' + (e.error ? esc(e.error) + '. Toque 📍 Sitio.' : 'se fija al bajar de ' + CONFIG.PRECISION_ACEPTABLE_M + ' m, o toque 📍 Sitio') + '</span></span>' +
      (largo && prec != null ? '<button class="enlace" id="gpsUsar">Usar ' + prec + ' m</button>' : '') +
      (largo ? '<button class="enlace" id="gpsEsperar">Seguir esperando</button>' : '') + '</div>';
    d.innerHTML = h;
    if ($('#gpsUsar')) $('#gpsUsar').onclick = function () { aceptarUbicacion(e.mejor, 'GPS'); };
    if ($('#gpsEsperar')) $('#gpsEsperar').onclick = function () { e.inicio = Date.now(); e.error = null; if (S.gpsWatch == null) iniciarGPS(); pintarGPS(); };
  }
  // Detecta la parroquia con la capa parroquial simplificada (100 m); cerca de un límite puede fallar y se corrige a mano
  function detectarTerritorio(lat, lon) {
    var f = S.ficha, cod = '';
    if (S.parroquias) {
      S.parroquias.features.some(function (ft) {
        var g = ft.geometry, polis = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
        var en = polis.some(function (p) { return puntoEnAnillo(lon, lat, p[0]) && !p.slice(1).some(function (h) { return puntoEnAnillo(lon, lat, h); }); });
        if (en && ft.properties.p !== 'ISLA') cod = ft.properties.p;
        return en;
      });
    }
    // Punto en la costa, en un río ancho o en un hueco de la capa: se toma la parroquia más cercana a menos de 2 km
    var cerca = null;
    if (!cod && S.parroquias) {
      var mejor = Infinity;
      S.parroquias.features.forEach(function (ft) {
        if (ft.properties.p === 'ISLA') return;
        var g = ft.geometry, polis = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
        polis.forEach(function (p) {
          var r = p[0];
          for (var i = 1; i < r.length; i++) {
            var d = distanciaASegmento(lat, lon, r[i - 1], r[i]);
            if (d < mejor) { mejor = d; cerca = ft.properties.p; }
          }
        });
      });
      if (mejor <= 2000) cod = cerca; else cerca = null;
      if (cerca) cerca = Math.round(mejor);
    }
    if (cod) {
      fijarParroquia(cod); S.selProv = cod.slice(0, 2); S.selCant = cod.slice(0, 4);
      pintarSelectsDPA();
      if ($('#msgParr')) $('#msgParr').textContent = cerca != null ? 'El punto está fuera de los límites parroquiales: se tomó la parroquia más cercana (a ' + cerca + ' m). Verifíquela.' : 'Detectada con el GPS; corríjala si no es correcta.';
    } else if ($('#msgParr')) {
      $('#msgParr').textContent = S.parroquias ? 'No se pudo detectar la parroquia en este punto. Elíjala en la lista.' : 'Elija la parroquia en la lista.';
    }
  }
  function revisarCercanos() {
    var f = S.ficha, u = f.ubicacion;
    var lista = listaEventos();
    var cerca = lista.filter(function (e) { return e.estado !== 'Cerrado' && distancia(u.lat, u.lon, e.lat, e.lon) <= CONFIG.UMBRAL_DUPLICADO_M; });
    var cerrados = lista.filter(function (e) { return e.estado === 'Cerrado' && distancia(u.lat, u.lon, e.lat, e.lon) <= CONFIG.UMBRAL_DUPLICADO_M; });
    if (cerca.length) {
      cerca.forEach(function (e) { e._d = distancia(u.lat, u.lon, e.lat, e.lon); });
      var m = modal('<h2>¿Es alguno de estos eventos?</h2><p class="muted">Ya hay eventos registrados a menos de ' + CONFIG.UMBRAL_DUPLICADO_M + ' m. Si es el mismo sitio, actualícelo en lugar de crear uno nuevo.</p>' +
        '<div id="mLista">' + cerca.map(itemEvento).join('') + '</div><button class="btn" id="mNuevo">No, es un sitio nuevo</button>');
      $$('#mLista .item', m).forEach(function (b) {
        b.onclick = function () {
          var ev = cerca.find(function (x) { return x.id_evento === b.getAttribute('data-id'); });
          DB.del('fichas', f.id_visita).then(function () {
            S.fichas = S.fichas.filter(function (x) { return x.id_visita !== f.id_visita; });
            cerrarModal(); nuevaFicha('ACTUALIZACION', ev);
          });
        };
      });
      $('#mNuevo', m).onclick = function () { cerrarModal(); ofrecerVinculo(cerrados); };
    } else ofrecerVinculo(cerrados);
  }
  function ofrecerVinculo(cerrados) {
    if (!cerrados.length) return;
    var e = cerrados[0];
    confirmar('Aquí hubo un evento ya cerrado (' + (e.sector || e.parroquia) + '). ¿Registrar este como una nueva ocurrencia en el mismo sitio?', 'Sí, vincular', 'No').then(function (ok) {
      if (ok) { S.ficha.evento_vinculado = e.id_evento; guardar(); toast('Vinculado como recurrencia'); }
    });
  }

  // ---------------- Paso 2: Evento ----------------
  function esMM() { return S.ficha && S.ficha.valores['Tipo de Evento'] === 'Movimiento en masa'; }
  function pasoEvento(cuerpo) {
    var f = S.ficha;
    var h = (esMM() ? '' : campoOpciones('Origen', CATALOGOS['Origen'], 'Origen observado') +
      campoOpciones('Nivel del Agua', CATALOGOS['Nivel del Agua'], 'Nivel del agua', { una: true }) +
      campoOpciones('Tendencia del Agua', CATALOGOS['Tendencia del Agua'], 'Tendencia del agua')) +
      campoOpciones('Estado del Evento', CATALOGOS['Estado del Evento'], 'Estado del evento', { oblig: true, info: 'estado' });
    h += '<div class="campo"><label for="t-desc">Descripción del evento</label><textarea id="t-desc" data-texto="Descripción" placeholder="Qué se observa en el sitio. Puede dictar con el micrófono del teclado.">' + esc(f.valores['Descripción']) + '</textarea></div>';
    cuerpo.innerHTML = h;
    enlazarOpciones(cuerpo);
    enlazarTexto(cuerpo);
  }

  // ---------------- Paso 3: Personas y viviendas ----------------
  function pasoPersonas(cuerpo) {
    // Solo si hay afectación: en el momento de la visita no se conocen las cifras
    cuerpo.innerHTML = '<p class="paso-sub">Indique si hay afectación. No se piden cifras.</p>' +
      campoOpciones('Hay Personas Afectadas', CATALOGOS['Afectación'], '¿Hay personas afectadas?', { oblig: true, una: true }) +
      campoOpciones('Hay Viviendas Afectadas', CATALOGOS['Afectación'], '¿Hay viviendas afectadas?', { oblig: true, una: true }) +
      '<div class="campo"><label for="t-afect">Descripción de la afectación</label><textarea id="t-afect" data-texto="Descripción de la Afectación" placeholder="Qué afectación se observa en personas y viviendas. Puede dictar con el micrófono del teclado.">' + esc(S.ficha.valores['Descripción de la Afectación']) + '</textarea></div>';
    enlazarOpciones(cuerpo);
    enlazarTexto(cuerpo);
  }
  function suma(a, b) {
    if (a === '' || b === '' || a == null || b == null) return '';
    return Number(a) + Number(b);
  }
  function advertencias() {
    var v = S.ficha.valores, a = [];
    if (v['Familias Afectadas'] !== '' && v['Personas Afectadas Directamente'] !== '' && Number(v['Personas Afectadas Directamente']) < Number(v['Familias Afectadas']))
      a.push('¿Seguro? Hay menos personas afectadas que familias afectadas.');
    if (v['Familias Damnificadas'] !== '' && v['Personas Damnificadas'] !== '' && Number(v['Personas Damnificadas']) < Number(v['Familias Damnificadas']))
      a.push('¿Seguro? Hay menos personas damnificadas que familias damnificadas.');
    if (Number(v['Viviendas Inhabitables']) > 0 && (v['Personas Damnificadas'] === '' || Number(v['Personas Damnificadas']) === 0))
      a.push('Hay viviendas inhabitables sin personas damnificadas.');
    return a;
  }
  function bajasSinJustificar() {
    var f = S.ficha; if (f.tipo !== 'ACTUALIZACION' || !f.base) return [];
    return CIFRAS_OBLIGATORIAS.filter(function (c) {
      return f.base[c] !== '' && f.base[c] != null && f.valores[c] !== '' && Number(f.valores[c]) < Number(f.base[c]);
    });
  }
  function pintarBaja(cont) {
    var bajas = bajasSinJustificar();
    if (!bajas.length) { if (S.ficha.valores['Justificación de Baja']) cambiar('Justificación de Baja', ''); cont.innerHTML = ''; return; }
    cont.innerHTML = '<div class="tarjeta" style="border:2px solid var(--alerta)"><b>Bajó: ' + bajas.map(function (c) { return esc(ETIQUETAS[c]); }).join(', ') + '.</b>' +
      campoOpciones('Justificación de Baja', CATALOGOS['Justificación de Baja'], 'Indique por qué', { oblig: true, info: 'baja', una: true }) + '</div>';
    enlazarOpciones(cont);
  }

  // ---------------- Paso 4: Servicios ----------------
  function pasoServicios(cuerpo) {
    var h = '<h3 style="display:flex;gap:8px;align-items:center">Servicios básicos ' + botonInfo('servicio') + '</h3>' +
      ['Agua Potable', 'Alcantarillado o Pozos Sépticos', 'Energía Eléctrica', 'Telefonía e Internet'].map(function (c) {
        return campoOpciones(c, CATALOGOS['Servicio'], c);
      }).join('') +
      campoOpciones('Vía de Acceso', CATALOGOS['Vía de Acceso'], 'Vía de acceso al sitio', { info: 'via' }) +
      '<p class="muted">La longitud de vía afectada se calcula del tramo que dibuje en el mapa.</p>' +
      '<h3>Infraestructura esencial afectada</h3>' +
      contador('Edificaciones Públicas Afectadas') + '<div id="fEdif"></div>' +
      contador('Muelles y Embarcaderos Afectados') + '<div id="fMuel"></div>';
    cuerpo.innerHTML = h;
    function refrescar() {
      var v = S.ficha.valores;
      var e = Number(v['Edificaciones Públicas Afectadas']) > 0, m = Number(v['Muelles y Embarcaderos Afectados']) > 0;
      if (!e && v['Funcionamiento Edificaciones Públicas']) cambiar('Funcionamiento Edificaciones Públicas', '');
      if (!m && v['Funcionamiento Muelles']) cambiar('Funcionamiento Muelles', '');
      $('#fEdif').innerHTML = e ? campoOpciones('Funcionamiento Edificaciones Públicas', CATALOGOS['Funcionamiento'], 'Funcionamiento de las edificaciones') : '';
      $('#fMuel').innerHTML = m ? campoOpciones('Funcionamiento Muelles', CATALOGOS['Funcionamiento'], 'Funcionamiento de los muelles') : '';
      enlazarOpciones($('#fEdif')); enlazarOpciones($('#fMuel'));
    }
    enlazarOpciones(cuerpo);
    enlazarContadores(cuerpo, refrescar);
    refrescar();
  }

  // ---------------- Paso 5: Medios de vida ----------------
  function pasoMedios(cuerpo) {
    cuerpo.innerHTML = campoMulti('Necesidades Inmediatas', CATALOGOS['Necesidades Inmediatas'], 'Necesidades inmediatas');
    enlazarOpciones(cuerpo);
  }

  // ---------------- Paso 6: Mapa ----------------
  function cajaGeom(g) {
    var b = [180, 90, -180, -90], polis = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    polis.forEach(function (p) { p[0].forEach(function (c) { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]); }); });
    return b;
  }
  function crearMapa(div, centro, zoom) {
    var mapa = L.map(div, { zoomControl: true, attributionControl: true, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false, maxZoom: 19 });
    // Mapa base propio (funciona sin señal en las áreas descargadas); la imagen satelital solo con señal
    var base = MapaBase.capa().addTo(mapa);
    var sat = L.tileLayer(CONFIG.TESELAS_SATELITE, { maxZoom: 19, maxNativeZoom: 18, attribution: CONFIG.TESELAS_SATELITE_ATRIB });
    var capas = { 'Mapa base': base, 'Satélite (requiere señal)': sat };
    var extra = {};
    if (S.parroquias) {
      // Solo las parroquias cercanas, dibujadas en canvas: la capa nacional completa sería pesada en un teléfono
      var c0 = centro || [-1.6, -78.6], radio = centro ? 0.35 : 0;
      var cerca = S.parroquias.features.filter(function (ft) {
        if (!radio) return false;
        var b = ft._caja || (ft._caja = cajaGeom(ft.geometry));
        return b[0] - radio <= c0[1] && b[2] + radio >= c0[1] && b[1] - radio <= c0[0] && b[3] + radio >= c0[0];
      });
      extra['Límites parroquiales'] = L.geoJSON({ type: 'FeatureCollection', features: cerca }, { renderer: L.canvas(), style: { color: '#64748b', weight: 1.5, dashArray: '2 5', fill: false }, interactive: false }).addTo(mapa);
    }
    L.control.layers(capas, extra, { collapsed: true }).addTo(mapa);
    if (centro) mapa.setView(centro, zoom || 15); else mapa.setView([-1.6, -78.6], 7);
    return mapa;
  }
  function agregarLeyenda(mapa, conTipos) {
    var c = L.control({ position: 'bottomleft' });
    c.onAdd = function () {
      var d = L.DomUtil.create('div', 'leyenda-mapa' + (conTipos ? ' plegable' : ''));
      if (conTipos) {
        // En el mapa de dibujo la leyenda va plegada para no tapar el área de trabajo
        d.innerHTML = '<button type="button" class="ley-btn">Leyenda</button><div class="ley-cont" hidden></div>';
        d.firstChild.onclick = function () { var c2 = d.lastChild; c2.hidden = !c2.hidden; d.firstChild.textContent = c2.hidden ? 'Leyenda' : 'Ocultar leyenda'; };
        d = { root: d, cont: d.lastChild };
      } else d = { root: d, cont: d };
      d.cont.innerHTML = CATALOGOS['Estado del Evento'].map(function (k) { return '<i style="background:' + COLOR_ESTADO[k] + '"></i>' + k; }).join('<br>') +
        (conTipos ? '<hr><span class="ls">📍</span>Sitio del evento<br><span class="lz"></span>Zona afectada<br><span class="lv"></span>Tramo de vía<br><span class="lc"></span>Cauce desbordado<br><span class="lp"></span>Punto crítico' : '');
      L.DomEvent.disableClickPropagation(d.root);
      return d.root;
    };
    c.addTo(mapa);
  }
  // ---------------- Paso 1: ubicación y zonas afectadas ----------------
  // Tipos que se pueden dibujar. 'Área inundada' (nombre anterior) se trata como 'Zona afectada'.
  var TIPOS_GEO = {
    'Zona afectada': { forma: 'poligono', min: 3, ayuda: 'Toque el mapa en cada esquina de la zona afectada.' },
    'Tramo de vía': { forma: 'linea', min: 2, ayuda: 'Toque el mapa a lo largo del tramo de vía afectado.' },
    'Cauce desbordado': { forma: 'linea', min: 2, ayuda: 'Toque el mapa siguiendo el río, quebrada o canal que se desbordó.' },
    'Punto crítico': { forma: 'punto', min: 1, ayuda: 'Toque el mapa en el punto crítico.' }
  };
  var MAX_GEOMETRIAS = 60;
  function grupoGeo(t) { return t === 'Área inundada' ? 'Zona afectada' : t; }
  // En movimiento en masa solo se dibuja el área afectada
  function tiposPermitidos() { return esMM() ? ['Zona afectada'] : Object.keys(TIPOS_GEO); }
  function nombreGeo(t) { return esMM() && grupoGeo(t) === 'Zona afectada' ? 'Área afectada' : grupoGeo(t); }
  function formaGeo(t) { return (TIPOS_GEO[grupoGeo(t)] || {}).forma; }
  function firmasGeo(lista) {
    var o = {};
    Object.keys(TIPOS_GEO).forEach(function (t) {
      o[t] = JSON.stringify(lista.filter(function (g) { return grupoGeo(g.tipo) === t; }).map(function (g) { return [g.coordenadas, g.detalle || '', g.nota || '']; }));
    });
    return o;
  }
  function geometriasAEnviar(f, todo) {
    var ahora = firmasGeo(f.geometrias), base = f.geoBase, envio = [];
    Object.keys(TIPOS_GEO).forEach(function (t) {
      var lista = f.geometrias.filter(function (g) { return grupoGeo(g.tipo) === t; });
      var antes = base ? (base[t] || '[]') : (lista.some(function (g) { return !g.precargada; }) ? null : ahora[t]);
      if (!todo && ahora[t] === antes) return;
      if (lista.length) lista.forEach(function (g) { envio.push({ id: todo ? uuid() : g.id, tipo: t, coordenadas: g.coordenadas, detalle: g.detalle || '', nota: g.nota || '' }); });
      else if (antes && antes !== '[]') envio.push({ tipo: t, vacio: true });
    });
    return envio;
  }
  function medidaGeo(g) {
    var fm = formaGeo(g.tipo);
    if (fm === 'poligono') return 'Área ' + Math.round(areaM2(g.coordenadas)).toLocaleString('es') + ' m²';
    if (fm === 'linea') return 'Longitud ' + metros(longitud(g.coordenadas));
    return g.coordenadas[0][1].toFixed(5) + ', ' + g.coordenadas[0][0].toFixed(5);
  }
  // Dibuja una geometría con el estilo de su tipo: zona sombreada, vía continua, cauce discontinuo, punto en rombo
  function capaGeo(g, color, opc) {
    opc = opc || {};
    var fm = formaGeo(g.tipo), ll = g.coordenadas.map(function (c) { return [c[1], c[0]]; });
    if (fm === 'poligono') return L.polygon(ll, { color: color, weight: opc.fino ? 2 : 3, fillOpacity: opc.fino ? .12 : .25, dashArray: opc.fino ? '4 4' : null, interactive: !opc.fino });
    if (fm === 'linea') return L.polyline(ll, { color: color, weight: opc.fino ? 4 : 7, opacity: .9, dashArray: grupoGeo(g.tipo) === 'Cauce desbordado' ? '12 8' : null, interactive: !opc.fino });
    return L.marker(ll[0], { icon: L.divIcon({ className: '', html: '<div class="rombo" style="background:' + color + '"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: !opc.fino });
  }

  function textoZonas() {
    $('#subZonas').textContent = esMM() ? 'En el mismo mapa, dibuje el área afectada (opcional).' : 'En el mismo mapa, dibuje lo que pueda (opcional, varios de cada uno).';
  }
  var ICONO_GEO = { poligono: '⬠', linea: '〰', punto: '◆' };
  var ICONO_SITIO = L.divIcon({ className: 'pin-sitio', iconSize: [34, 46], iconAnchor: [17, 45],
    html: '<svg viewBox="0 0 34 46" width="34" height="46" aria-label="Sitio del evento"><path d="M17 1C8.2 1 1 8 1 16.8 1 28.5 17 45 17 45s16-16.5 16-28.2C33 8 25.8 1 17 1z" fill="#D62828" stroke="#fff" stroke-width="2"/><circle cx="17" cy="16.5" r="6" fill="#fff"/></svg>' });
  var CORTO_GEO = { 'Zona afectada': 'Zona', 'Tramo de vía': 'Vía', 'Cauce desbordado': 'Cauce', 'Punto crítico': 'Punto' };
  function pasoUbicacionZonas(cuerpo) {
    // Orden: tipo de evento; al elegirlo aparecen provincia, cantón y parroquia en una fila, el sector y el mapa
    var f = S.ficha, oculto = f.tipo === 'INICIAL' && !f.valores['Tipo de Evento'];
    cuerpo.innerHTML = '<div id="ubic"></div>' +
      '<p class="muted" id="pideTipo"' + (oculto ? '' : ' hidden') + '>Elija el tipo de evento para abrir el mapa.</p>' +
      '<div id="bloqueMapa"' + (oculto ? ' hidden' : '') + '><div id="ubicAbajo"></div>' +
      '<div class="mapa-caja" id="cajaMapa"><div id="herr"></div><div class="mapa" id="mapaFicha"></div><div id="gps"></div></div>' +
      '<p class="muted ayuda-zonas" id="subZonas"></p><div id="geoms"></div></div>';
    pasoUbicacion($('#ubic'), $('#ubicAbajo'));
    editorZonas();
    textoZonas();
    S.mostrarMapa = function () {
      var b = $('#bloqueMapa'); if (!b || !b.hidden) return;
      b.hidden = false; $('#pideTipo').hidden = true;
      setTimeout(function () { b.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
      if (S.mapa) {
        S.mapa.invalidateSize();
        var e = S.gpsEstado || {};
        if (f.ubicacion) S.mapa.setView([f.ubicacion.lat, f.ubicacion.lon], 17);
        else if (e.mejor) S.mapa.setView([e.mejor.lat, e.mejor.lon], 16);
        if (S.alGPS) S.alGPS();
      }
    };
  }

  function editorZonas() {
    var f = S.ficha;
    var u = f.ubicacion;
    var centro = u ? [u.lat, u.lon] : (S.gpsEstado && S.gpsEstado.mejor ? [S.gpsEstado.mejor.lat, S.gpsEstado.mejor.lon] : null);
    var mapa = S.mapa = crearMapa($('#mapaFicha'), centro, u ? 17 : 15);
    agregarLeyenda(mapa, true);
    var capaOtros = L.layerGroup().addTo(mapa), capaFicha = L.layerGroup().addTo(mapa), capaTemp = L.layerGroup().addTo(mapa);
    function pintarOtros() {
      capaOtros.clearLayers();
      var c = f.ubicacion || (centro ? { lat: centro[0], lon: centro[1] } : null);
      listaEventos().forEach(function (e) {
        if (e.id_evento === f.id_evento) return;
        if (c && distancia(c.lat, c.lon, e.lat, e.lon) > 3000) return;
        var col = COLOR_ESTADO[e.estado] || '#555';
        L.circleMarker([e.lat, e.lon], { radius: 8, color: '#fff', weight: 2, fillColor: col, fillOpacity: .9 }).bindTooltip(esc(e.sector || e.parroquia)).addTo(capaOtros);
        (e.geometrias || []).map(geomDeServidor).forEach(function (g) { capaGeo(g, col, { fino: true }).addTo(capaOtros); });
      });
    }
    var modo = null, verts = [], caminar = null;

    function pintarFicha() {
      capaFicha.clearLayers();
      var color = COLOR_ESTADO[f.valores['Estado del Evento']] || '#013254';
      var uu = f.ubicacion;
      // Sitio del evento: globito rojo; no captura toques, así se puede dibujar encima
      if (uu && uu.lat != null) L.marker([uu.lat, uu.lon], { icon: ICONO_SITIO, interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(capaFicha);
      f.geometrias.forEach(function (g, i) {
        capaGeo(g, color).on('click', function () { if (!modo) editarGeo(i); }).addTo(capaFicha);
      });
      $('#geoms').innerHTML = f.geometrias.map(function (g, i) {
        var t = nombreGeo(g.tipo) + (g.detalle ? ': ' + g.detalle : '');
        return '<div class="tarjeta geo-item" data-ver="' + i + '"><div style="flex:1"><b>' + esc(t) + '</b><br><span class="muted">' + medidaGeo(g) + '</span>' +
          (g.nota ? '<br><span>' + esc(g.nota) + '</span>' : '') + '</div>' +
          '<button class="btn chico" data-editar="' + i + '">Nota</button><button class="btn chico peligro" data-quitar="' + i + '">Quitar</button></div>';
      }).join('');
      $$('[data-quitar]').forEach(function (b) {
        b.onclick = function (ev) {
          ev.stopPropagation();
          confirmar('¿Quitar este elemento del mapa?', 'Quitar').then(function (ok) {
            if (!ok) return; f.geometrias.splice(Number(b.getAttribute('data-quitar')), 1); guardar(); pintarFicha(); herramientas();
          });
        };
      });
      $$('[data-editar]').forEach(function (b) { b.onclick = function (ev) { ev.stopPropagation(); editarGeo(Number(b.getAttribute('data-editar'))); }; });
      $$('[data-ver]').forEach(function (b) {
        b.onclick = function () {
          var capa = capaGeo(f.geometrias[Number(b.getAttribute('data-ver'))], '#000');
          if (capa.getBounds) mapa.fitBounds(capa.getBounds().pad(0.4), { maxZoom: 18 }); else mapa.setView(capa.getLatLng(), 18);
          $('#mapaFicha').scrollIntoView({ behavior: 'smooth', block: 'center' });
        };
      });
    }
    // Nota (y tipo de punto crítico) de un elemento ya dibujado
    function editarGeo(i, nuevo) {
      var g = f.geometrias[i];
      var esPunto = formaGeo(g.tipo) === 'punto';
      var m = modal('<h2>' + esc(grupoGeo(g.tipo)) + '</h2>' +
        (esPunto ? '<div class="etq">¿Qué hay en este punto? <span class="oblig">*</span></div><div class="opciones" id="mDet">' +
          CATALOGOS['Detalle Punto Crítico'].map(function (o) { return '<button type="button" class="op' + (g.detalle === o ? ' sel' : '') + '" data-o="' + esc(o) + '">' + esc(o) + '</button>'; }).join('') + '</div>' : '') +
        '<div class="campo"><label for="mNota">Nota (opcional)</label><input type="text" id="mNota" maxlength="300" value="' + esc(g.nota || '') + '" placeholder="Ej.: agua hasta la rodilla, calle sin paso"><p class="muted">Puede dictar con el micrófono del teclado.</p></div>' +
        '<div class="fila-btn"><button class="btn" id="mNo">' + (nuevo ? 'Quitar punto' : 'Cancelar') + '</button>' +
        '<button class="btn primario" id="mOk"' + (esPunto && !g.detalle ? ' disabled' : '') + '>Listo</button></div>');
      $('#mNo', m).onclick = function () {
        if (nuevo) { f.geometrias.splice(i, 1); guardar(); }
        cerrarModal(); pintarFicha(); herramientas();
      };
      var det = g.detalle || '';
      $$('#mDet .op', m).forEach(function (b) {
        b.onclick = function () { det = b.getAttribute('data-o'); $$('#mDet .op', m).forEach(function (x) { x.classList.toggle('sel', x === b); }); $('#mOk', m).disabled = false; };
      });
      $('#mOk', m).onclick = function () {
        g.detalle = esPunto ? det : ''; g.nota = $('#mNota', m).value.trim();
        cerrarModal(); guardar(); pintarFicha();
      };
    }
    function pintarTemp() {
      capaTemp.clearLayers();
      var ll = verts.map(function (c) { return [c[1], c[0]]; });
      ll.forEach(function (p) { L.circleMarker(p, { radius: 5, color: '#013254', fillColor: '#fff', fillOpacity: 1 }).addTo(capaTemp); });
      if (ll.length > 1) (TIPOS_GEO[modo] && TIPOS_GEO[modo].forma === 'linea' ? L.polyline(ll, { color: '#013254', weight: 6, dashArray: modo === 'Cauce desbordado' ? '12 8' : null }) : L.polygon(ll, { color: '#013254', weight: 3, dashArray: '6 4', fillOpacity: .15 })).addTo(capaTemp);
    }
    function herramientas() {
      var h;
      if (modo === 'sitio') {
        h = '<div class="aviso info"><b>Sitio del evento:</b> toque el mapa en el lugar afectado. Puede acercar con dos dedos antes de tocar.</div>' +
          '<div class="herr"><button class="btn" id="hCancelar" style="grid-column:1/-1">Cancelar</button></div>';
      } else if (!modo) {
        var lleno = f.geometrias.length >= MAX_GEOMETRIAS;
        var sitio = f.tipo === 'INICIAL' ? '<button class="hbtn sitio" id="gpsMapa">📍 ' + (f.ubicacion && f.ubicacion.aceptada ? 'Mover sitio' : 'Marcar sitio') + '</button>' : '';
        h = '<div class="barra-mapa">' + sitio + (lleno ? '' :
          tiposPermitidos().map(function (t) { return '<button class="hbtn" data-dibujar="' + esc(t) + '">' + ICONO_GEO[formaGeo(t)] + ' ' + esc(esMM() ? nombreGeo(t) : (CORTO_GEO[t] || nombreGeo(t))) + '</button>'; }).join('') +
          '<button class="hbtn" id="hCaminar">🚶 Caminar borde</button>') + '</div>' +
          (lleno ? '<div class="aviso alerta">Llegó al máximo de ' + MAX_GEOMETRIAS + ' elementos en esta ficha.</div>' : '');
      } else if (modo === 'caminar') {
        h = '<div class="aviso info">Camine por el borde de la zona. Puntos tomados: <b id="nPts">' + verts.length + '</b>. Se descartan los de precisión peor que ' + CONFIG.PRECISION_ACEPTABLE_M + ' m.</div>' +
          '<div class="herr"><button class="btn" id="hCancelar">Cancelar</button><button class="btn primario" id="hTerminar"' + (verts.length >= 3 ? '' : ' disabled') + '>Terminar</button></div>';
      } else {
        var min = TIPOS_GEO[modo].min;
        h = '<div class="aviso info"><b>' + esc(nombreGeo(modo)) + ':</b> ' + (esMM() && modo === 'Zona afectada' ? 'Toque el mapa en cada esquina del área afectada por el movimiento en masa.' : TIPOS_GEO[modo].ayuda) + (min > 1 ? ' Puntos: <b>' + verts.length + '</b>' : '') + '</div>' +
          '<div class="herr' + (min > 1 ? ' tres' : '') + '">' + (min > 1 ? '<button class="btn" id="hDeshacer"' + (verts.length ? '' : ' disabled') + '>Deshacer</button>' : '') + '<button class="btn" id="hCancelar"' + (min > 1 ? '' : ' style="grid-column:1/-1"') + '>Cancelar</button>' +
          (min > 1 ? '<button class="btn primario" id="hTerminar"' + (verts.length >= min ? '' : ' disabled') + '>Terminar</button>' : '') + '</div>';
      }
      $('#herr').innerHTML = h;
      // Mientras se dibuja: se ocultan Salir/Siguiente y el mapa ocupa el alto disponible
      document.body.classList.toggle('dibujando', !!modo);
      setTimeout(function () { if (S.mapa === mapa) mapa.invalidateSize(); }, 50);
      $$('[data-dibujar]').forEach(function (b) { b.onclick = function () { modo = b.getAttribute('data-dibujar'); verts = []; herramientas(); $('#cajaMapa').scrollIntoView({ behavior: 'smooth', block: 'start' }); }; });
      if ($('#gpsMapa')) $('#gpsMapa').onclick = function () { if (S.marcarSitio) S.marcarSitio(); };
      if ($('#hCaminar')) $('#hCaminar').onclick = iniciarCaminata;
      if ($('#hDeshacer')) $('#hDeshacer').onclick = function () { verts.pop(); pintarTemp(); herramientas(); };
      if ($('#hCancelar')) $('#hCancelar').onclick = function () {
        var eraSitio = modo === 'sitio';
        terminarCaminata(); modo = null; verts = []; S.marcandoSitio = false; pintarTemp(); herramientas();
        if (eraSitio && !(f.ubicacion && f.ubicacion.aceptada)) iniciarGPS();
        pintarGPS();
      };
      if ($('#hTerminar')) $('#hTerminar').onclick = terminar;
    }
    function terminar() {
      var tipo = modo === 'caminar' ? 'Zona afectada' : modo;
      terminarCaminata();
      if (verts.length < TIPOS_GEO[tipo].min) { toast('Faltan puntos'); return; }
      f.geometrias.push({ id: uuid(), tipo: tipo, coordenadas: verts.map(function (c) { return [Number(c[0].toFixed(6)), Number(c[1].toFixed(6))]; }), detalle: '', nota: '' });
      modo = null; verts = []; guardar(); pintarTemp(); pintarFicha(); herramientas();
      // El punto crítico necesita su tipo: se pregunta enseguida
      if (tipo === 'Punto crítico') editarGeo(f.geometrias.length - 1, true);
    }
    function iniciarCaminata() {
      modo = 'caminar'; verts = [];
      caminar = navigator.geolocation.watchPosition(function (p) {
        var c = p.coords; if (c.accuracy > CONFIG.PRECISION_ACEPTABLE_M) return;
        var ult = verts[verts.length - 1];
        if (ult && distancia(ult[1], ult[0], c.latitude, c.longitude) < 3) return;
        verts.push([c.longitude, c.latitude]); pintarTemp();
        if ($('#nPts')) $('#nPts').textContent = verts.length;
        if ($('#hTerminar')) $('#hTerminar').disabled = verts.length < 3;
        mapa.panTo([c.latitude, c.longitude]);
      }, function () {}, { enableHighAccuracy: true, maximumAge: 0 });
      herramientas();
    }
    function terminarCaminata() { if (caminar != null) { navigator.geolocation.clearWatch(caminar); caminar = null; } }
    S.detenerExtra = terminarCaminata;
    mapa.on('click', function (ev) {
      if (modo === 'sitio') {
        modo = null; S.marcandoSitio = false; herramientas();
        aceptarUbicacion({ lat: ev.latlng.lat, lon: ev.latlng.lng }, 'Manual');
        return;
      }
      if (!modo || modo === 'caminar') return;
      verts.push([ev.latlng.lng, ev.latlng.lat]); pintarTemp();
      if (TIPOS_GEO[modo].forma === 'punto') { terminar(); return; }
      herramientas();
    });
    // Cuando se fija o cambia la ubicación del sitio, el mapa la sigue
    S.alUbicar = function () {
      pintarFicha(); pintarOtros();
      var uu = f.ubicacion;
      if (uu && uu.lat != null && !f.geometrias.length) mapa.setView([uu.lat, uu.lon], 17);
    };
    S.alTipo = function () { textoZonas(); pintarFicha(); herramientas(); };
    // Marcar o mover el sitio del evento tocando este mismo mapa (sin ventana aparte)
    S.marcarSitio = function () {
      if (f.tipo !== 'INICIAL') return;
      detenerGPS(); terminarCaminata();
      modo = 'sitio'; verts = []; S.marcandoSitio = true; pintarTemp(); herramientas(); pintarGPS();
      var e = S.gpsEstado || {};
      if (!f.ubicacion && e.mejor) mapa.setView([e.mejor.lat, e.mejor.lon], Math.max(mapa.getZoom(), 16));
      $('#cajaMapa').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    // Mientras el GPS busca, se muestra en el mapa la posición aproximada con su margen de error
    var capaGPS = L.layerGroup().addTo(mapa), centrado = false;
    S.alGPS = function () {
      capaGPS.clearLayers();
      var e = S.gpsEstado || {};
      if ((f.ubicacion && f.ubicacion.aceptada) || !e.mejor || S.gpsWatch == null) return;
      L.circle([e.mejor.lat, e.mejor.lon], { radius: e.mejor.precision, color: '#013254', weight: 1, fillOpacity: .08, interactive: false }).addTo(capaGPS);
      L.circleMarker([e.mejor.lat, e.mejor.lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#2a7de1', fillOpacity: 1, interactive: false }).addTo(capaGPS);
      if (!centrado && !f.geometrias.length) { centrado = true; mapa.setView([e.mejor.lat, e.mejor.lon], 16); }
    };
    S.refrescarBarra = function () { if (!modo) herramientas(); };
    S.alGPS();
    pintarOtros(); pintarFicha(); herramientas();
    var g = capaFicha.getLayers().length > 1 ? L.featureGroup(capaFicha.getLayers()) : null;
    if (g) mapa.fitBounds(g.getBounds().pad(0.4), { maxZoom: 18 });
  }
  function longitud(c) { var s = 0; for (var i = 1; i < c.length; i++) s += distancia(c[i - 1][1], c[i - 1][0], c[i][1], c[i][0]); return s; }
  function areaM2(c) {
    var anillo = c.concat([c[0]]), lat0 = c[0][1] * Math.PI / 180, R = 6371008.8, r = Math.PI / 180, s = 0;
    for (var i = 0; i < anillo.length - 1; i++) {
      s += (anillo[i][0] * r * R * Math.cos(lat0)) * (anillo[i + 1][1] * r * R) - (anillo[i + 1][0] * r * R * Math.cos(lat0)) * (anillo[i][1] * r * R);
    }
    return Math.abs(s / 2);
  }

  // ---------------- Paso 7: Fotos y envío ----------------
  function pasoEnvio(cuerpo) {
    var f = S.ficha;
    var h = '';
    if (f.tipo !== 'CORRECCION') {
      h += '<div class="tarjeta"><h2>Fotos (opcional, hasta ' + CONFIG.MAX_FOTOS + ')</h2>' +
        '<div class="aviso info" style="font-weight:500">Fotografíe el daño. Evite rostros, sobre todo de niñas y niños: estas fotos pueden ir a informes.</div>' +
        '<div class="fila-btn"><label class="btn primario" style="margin:0">📷 Tomar foto<input type="file" accept="image/*" capture="environment" id="fCam" hidden></label>' +
        '<label class="btn" style="margin:0">Galería<input type="file" accept="image/*" multiple id="fGal" hidden></label></div>' +
        '<div class="fotos" id="listaFotos" style="margin-top:12px"></div></div>';
    }
    h += '<div class="tarjeta"><h2>Resumen</h2><div id="bloqueos"></div><table class="resumen" id="resumen"></table></div>' +
      '<button class="btn accion" id="enviar">Enviar ficha</button>';
    cuerpo.innerHTML = h;
    if (f.tipo !== 'CORRECCION') {
      $('#fCam').onchange = function () { agregarFotos(this.files, f.id_visita).then(function () { pintarFotos(); }); this.value = ''; };
      $('#fGal').onchange = function () { agregarFotos(this.files, f.id_visita).then(function () { pintarFotos(); }); this.value = ''; };
      pintarFotos();
    }
    pintarResumen();
    $('#enviar').onclick = enviarFicha;
  }
  function bloqueos() {
    var f = S.ficha, v = f.valores, b = [];
    if (!f.ubicacion || f.ubicacion.lat == null) b.push([1, 'Falta la ubicación']);
    if (f.tipo === 'INICIAL' && f.ubicacion && !f.ubicacion.aceptada) b.push([1, 'Falta confirmar la ubicación']);
    if (f.tipo === 'INICIAL' && !v['Tipo de Evento']) b.push([1, 'Falta el tipo de evento']);
    if (!v['Código Parroquia'] && !(f.tipo !== 'INICIAL' && v['Parroquia'])) b.push([1, 'Falta la provincia, el cantón o la parroquia']);
    if (!v['Estado del Evento']) b.push([2, 'Falta el estado del evento']);
    if (f.geometrias.some(function (g) { return formaGeo(g.tipo) === 'punto' && !g.detalle; })) b.push([1, 'Falta indicar qué hay en un punto crítico (toque "Nota")']);
    if (!v['Hay Personas Afectadas']) b.push([3, 'Falta indicar si hay personas afectadas']);
    if (!v['Hay Viviendas Afectadas']) b.push([3, 'Falta indicar si hay viviendas afectadas']);
    if (f.tipo === 'CORRECCION' && !Object.keys(diferencias()).length && !geometriaCambio()) b.push([1, 'No hay cambios que corregir']);
    return b;
  }
  function pintarResumen() {
    var f = S.ficha, v = f.valores;
    var bl = bloqueos();
    $('#bloqueos').innerHTML = bl.map(function (x) { return '<div class="aviso error" data-paso="' + x[0] + '" style="cursor:pointer">' + esc(x[1]) + ' ›</div>'; }).join('') +
      advertencias().map(function (a) { return '<div class="aviso alerta" data-paso="3" style="cursor:pointer">' + esc(a) + '</div>'; }).join('') +
      (f.tipo === 'INICIAL' && !f.geometrias.some(function (g) { return formaGeo(g.tipo) === 'poligono'; }) ? '<div class="aviso alerta" data-paso="1" style="cursor:pointer">' + (esMM() ? 'No se dibujó el área afectada' : 'No se dibujó ninguna zona afectada') + '. Puede enviar igual o volver al mapa ›</div>' : '');
    function fila(et, val, paso) { return '<tr class="ir" data-paso="' + paso + '"><td>' + esc(et) + '</td><td><b>' + (val === '' || val == null ? '<span class="muted">Sin dato</span>' : esc(val)) + '</b></td></tr>'; }
    DB.porIndice('fotos', 'id_visita', f.id_visita).then(function (fotos) {
      $('#resumen').innerHTML =
        fila('Tipo de evento', v['Tipo de Evento'] || 'Inundación', 1) +
        fila('Sitio', (v['Sector'] || '') + (v['Parroquia'] ? ' · ' + v['Parroquia'] + ', ' + v['Cantón'] + (v['Provincia'] ? ', ' + v['Provincia'] : '') : ''), 1) +
        fila('Estado', v['Estado del Evento'], 2) +
        fila('Personas afectadas', v['Hay Personas Afectadas'], 3) +
        fila('Viviendas afectadas', v['Hay Viviendas Afectadas'], 3) +
        fila('Mapa', f.geometrias.length ? resumenGeo(f.geometrias) : 'Solo el punto del sitio', 1) +
        (f.tipo !== 'CORRECCION' ? fila('Fotos', String(fotos.length), PASO_ENVIO) : '');
      $$('[data-paso]').forEach(function (r) { r.onclick = function () { guardar(); vistaPaso(Number(r.getAttribute('data-paso'))); }; });
    });
    $('#enviar').disabled = bl.length > 0;
  }
  function fmt(x) { return x === '' || x == null ? 'sin dato' : String(x).replace('.', ','); }
  function resumenGeo(lista) {
    var n = {}; lista.forEach(function (g) { var t = grupoGeo(g.tipo); n[t] = (n[t] || 0) + 1; });
    return Object.keys(n).map(function (t) { return n[t] + ' ' + (n[t] > 1 ? { 'Zona afectada': 'zonas afectadas', 'Tramo de vía': 'tramos de vía', 'Cauce desbordado': 'cauces desbordados', 'Punto crítico': 'puntos críticos' }[t] : t.toLowerCase()); }).join(', ');
  }

  function comprimir(file) {
    var objetivo = CONFIG.FOTO_OBJETIVO_KB * 1024;
    return new Promise(function (ok, mal) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var max = 1600, q = 0.75, intento = 0;
        (function paso() {
          var esc2 = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
          var c = document.createElement('canvas');
          c.width = Math.round(img.naturalWidth * esc2); c.height = Math.round(img.naturalHeight * esc2);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          c.toBlob(function (b) {
            intento++;
            if (b.size > objetivo * 1.2 && intento < 5) { max = Math.round(max * 0.85); q = Math.max(0.5, q - 0.07); paso(); }
            else { URL.revokeObjectURL(url); ok(b); }
          }, 'image/jpeg', q);
        })();
      };
      img.onerror = function () { URL.revokeObjectURL(url); mal(new Error('No se pudo leer la imagen')); };
      img.src = url;
    });
  }
  function posicionRapida() {
    return new Promise(function (ok) {
      if (!navigator.geolocation) return ok(null);
      navigator.geolocation.getCurrentPosition(function (p) { ok({ lat: p.coords.latitude, lon: p.coords.longitude }); }, function () { ok(null); }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 120000 });
    });
  }
  function agregarFotos(files, idVisita) {
    var lista = Array.prototype.slice.call(files || []); // copia antes de que se limpie el campo
    return DB.porIndice('fotos', 'id_visita', idVisita).then(function (existentes) {
      var libres = CONFIG.MAX_FOTOS - existentes.length;
      if (lista.length > libres) toast('Máximo ' + CONFIG.MAX_FOTOS + ' fotos por ficha');
      lista = lista.slice(0, Math.max(0, libres));
      if (!lista.length) return;
      toast('Procesando ' + lista.length + ' foto(s)…');
      return posicionRapida().then(function (pos) {
        return lista.reduce(function (p, file) {
          return p.then(function () { return comprimir(file); }).then(function (blob) {
            return DB.put('fotos', { id_foto: uuid(), id_visita: idVisita, blob: blob, etiqueta: '', fecha: ahoraISO(),
              lat: pos ? pos.lat : '', lon: pos ? pos.lon : '', estado: 'pendiente' });
          }).catch(function (e) { toast(e.message); });
        }, Promise.resolve());
      });
    });
  }
  function pintarFotos(contenedor, idVisita, soloLectura) {
    var cont = contenedor || $('#listaFotos'); idVisita = idVisita || S.ficha.id_visita;
    if (!cont) return Promise.resolve();
    return DB.porIndice('fotos', 'id_visita', idVisita).then(function (fotos) {
      (cont._urls || []).forEach(URL.revokeObjectURL); cont._urls = [];
      cont.innerHTML = fotos.map(function (x) {
        var u = URL.createObjectURL(x.blob); cont._urls.push(u);
        var enviada = x.estado === 'enviada';
        return '<div class="foto"><img src="' + u + '" alt="Foto">' +
          (enviada ? '<span class="chip verde est">Enviada</span>' : (!soloLectura ? '<button class="quitar" data-q="' + x.id_foto + '" aria-label="Quitar">×</button>' : '')) +
          '<div class="pie"><select data-et="' + x.id_foto + '"' + (enviada ? ' disabled' : '') + '><option value="">Etiqueta…</option>' +
          CATALOGOS['Etiqueta Foto'].map(function (e) { return '<option' + (x.etiqueta === e ? ' selected' : '') + '>' + e + '</option>'; }).join('') + '</select></div></div>';
      }).join('') || '<p class="muted">Sin fotos.</p>';
      $$('[data-q]', cont).forEach(function (b) {
        b.onclick = function () { DB.del('fotos', b.getAttribute('data-q')).then(function () { pintarFotos(contenedor, idVisita, soloLectura); if ($('#resumen')) pintarResumen(); }); };
      });
      $$('[data-et]', cont).forEach(function (s) {
        s.onchange = function () { var id = s.getAttribute('data-et'); DB.get('fotos', id).then(function (x) { x.etiqueta = s.value; return DB.put('fotos', x); }); };
      });
      if ($('#resumen') && !contenedor) pintarResumen();
    });
  }

  function diferencias() {
    var f = S.ficha, d = {};
    Object.keys(f.valores).forEach(function (k) {
      if (JSON.stringify(f.valores[k]) !== JSON.stringify(f.base[k])) d[k] = f.valores[k];
    });
    if (f.ubicacion_base && (f.ubicacion.lat !== f.ubicacion_base.lat || f.ubicacion.lon !== f.ubicacion_base.lon)) {
      d['Latitud'] = f.ubicacion.lat; d['Longitud'] = f.ubicacion.lon;
      d['Precisión (m)'] = f.ubicacion.precision == null ? '' : Math.round(f.ubicacion.precision);
      d['Método Ubicación'] = f.ubicacion.metodo;
    }
    return d;
  }
  // Solo aplica a correcciones: compara con la geometría original de la visita
  function geometriaCambio() {
    var f = S.ficha;
    return JSON.stringify(firmasGeo(f.geometrias)) !== f.geometrias_base;
  }

  function enviarFicha() {
    var f = S.ficha;
    if (bloqueos().length) return pintarResumen();
    DB.porIndice('fotos', 'id_visita', f.id_visita).then(function (fotos) {
      f.fotos_declaradas = fotos.length;
      if (f.tipo === 'CORRECCION') {
        f.cambios = diferencias();
        f.fecha_observacion = ahoraISO();
        // La corrección reemplaza todas las geometrías de la visita corregida
        f.geometrias_envio = geometriaCambio() ? geometriasAEnviar(f, true) : [];
      } else {
        // Solo se envían los tipos que cambiaron en esta visita, cada uno con su conjunto completo
        f.geometrias_envio = geometriasAEnviar(f, false);
      }
      f.estado = 'pendiente';
      f.encolada = ahoraISO();
      f.error = '';
      return guardar();
    }).then(function () {
      if ('serviceWorker' in navigator) navigator.serviceWorker.ready.then(function (r) { if (r.sync) r.sync.register('enviar-fichas').catch(function () {}); });
      var enLinea = navigator.onLine;
      var m = modal('<h2>' + (enLinea ? 'Enviando…' : 'Guardada en el teléfono') + '</h2><p id="mTxt">' +
        (enLinea ? 'La ficha queda como enviada solo cuando el servidor confirma que la recibió.' : 'Se enviará automáticamente cuando haya señal.') + '</p>' +
        '<button class="btn primario" id="mOk">Ir al inicio</button>');
      $('#mOk', m).onclick = function () { cerrarModal(); S.ficha = null; cargarDatos().then(vistaInicio); };
      if (enLinea) {
        Sync.sincronizar().then(function (r) {
          return DB.get('fichas', f.id_visita).then(function (g) {
            if (!$('#mTxt')) return;
            if (g.estado === 'enviada') $('#mTxt').innerHTML = '✓ El servidor recibió la ficha.' + (g.avisos && g.avisos.length ? '<br><b>' + esc(g.avisos.join('. ')) + '</b>' : '') + (r.fotos ? '<br>Fotos enviadas: ' + r.fotos : '');
            else if (g.estado === 'error') $('#mTxt').innerHTML = '<span style="color:var(--error)"><b>El servidor rechazó la ficha:</b> ' + esc(g.error) + '</span><br>Ábrala desde Mis fichas para corregirla.';
            else $('#mTxt').textContent = 'No se pudo enviar ahora. Quedó guardada y se enviará cuando haya señal.';
          });
        });
      }
    });
  }

  // ----------------------------------------------------------------
  // Mis fichas
  // ----------------------------------------------------------------
  function vistaMisFichas() {
    limpiarVista(); marcar('mis'); titulo('Mis fichas', vistaInicio);
    Promise.all([DB.todos('fichas'), DB.todos('fotos')]).then(function (r) {
      S.fichas = r[0];
      var fotos = r[1];
      var orden = { error: 0, borrador: 1, pendiente: 2, enviando: 2, enviada: 3 };
      var lista = S.fichas.slice().sort(function (a, b) { return (orden[a.estado] - orden[b.estado]) || (msDe(b.actualizada) - msDe(a.actualizada)); });
      var nombres = { borrador: 'Borrador', pendiente: 'Pendiente de envío', enviando: 'Enviando', enviada: 'Enviada', error: 'Error' };
      var color = { borrador: 'amb', pendiente: 'azul', enviando: 'azul', enviada: 'verde', error: 'rojo' };
      $('#vista').innerHTML = lista.length ? lista.map(function (f) {
        var fs = fotos.filter(function (x) { return x.id_visita === f.id_visita; });
        var fe = fs.filter(function (x) { return x.estado === 'enviada'; }).length;
        var acciones = '';
        if (f.estado === 'borrador') acciones = '<button class="btn chico primario" data-a="abrir">Continuar</button><button class="btn chico peligro" data-a="borrar">Descartar</button>';
        else if (f.estado === 'pendiente') acciones = '<button class="btn chico" data-a="abrir">Editar antes de enviar</button>';
        else if (f.estado === 'error') acciones = '<button class="btn chico primario" data-a="abrir">Corregir y reenviar</button>';
        else if (f.estado === 'enviada') {
          if (f.tipo !== 'CORRECCION' && f.autor === S.sesion.codigo) acciones += '<button class="btn chico" data-a="corregir">Corregir un dato</button>';
          if (f.tipo !== 'CORRECCION') acciones += '<button class="btn chico" data-a="fotos">Agregar fotos</button>';
        }
        return '<div class="tarjeta" data-id="' + f.id_visita + '"><div style="display:flex;justify-content:space-between;gap:8px"><b>' + esc(nombreTipo(f)) + ': ' + esc(f.valores['Sector'] || f.id_evento) + '</b>' +
          '<span class="chip ' + color[f.estado] + '">' + nombres[f.estado] + '</span></div>' +
          '<div class="muted">' + esc(f.valores['Parroquia'] || '') + ' · observado ' + fechaLegible(f.fecha_observacion) + (f.autor !== S.sesion.codigo ? ' · autor ' + esc(f.autor) : '') + '</div>' +
          (fs.length ? '<div class="muted">Fotos: ' + (f.estado === 'enviada' && fe < fs.length ? 'subiendo ' + fe + ' de ' + fs.length : fs.length) + '</div>' : '') +
          (f.error ? '<div class="aviso ' + (f.estado === 'error' ? 'error' : 'alerta') + '" style="margin-top:8px">' + esc(f.error) + '</div>' : '') +
          (f.avisos && f.avisos.length ? '<div class="aviso info" style="margin-top:8px">' + esc(f.avisos.join('. ')) + '</div>' : '') +
          '<div class="fila-btn" style="margin-top:10px;flex-wrap:wrap">' + acciones + '</div></div>';
      }).join('') : '<p class="muted">Aún no hay fichas en este teléfono.</p>';
      $$('[data-a]').forEach(function (b) {
        b.onclick = function () {
          var id = b.closest('[data-id]').getAttribute('data-id');
          var f = S.fichas.find(function (x) { return x.id_visita === id; });
          var a = b.getAttribute('data-a');
          if (a === 'abrir') abrirFicha(f, f.estado === 'error' ? PASO_ENVIO : null);
          if (a === 'corregir') nuevaFicha('CORRECCION', null, f);
          if (a === 'fotos') vistaFotosPosteriores(f);
          if (a === 'borrar') confirmar('¿Descartar este borrador? Se perderán sus datos y fotos.', 'Descartar').then(function (ok) {
            if (!ok) return;
            DB.porIndice('fotos', 'id_visita', id).then(function (fs) { return Promise.all(fs.map(function (x) { return DB.del('fotos', x.id_foto); })); })
              .then(function () { return DB.del('fichas', id); }).then(vistaMisFichas);
          });
        };
      });
    });
  }
  function vistaFotosPosteriores(f) {
    limpiarVista(); marcar('fotos'); titulo('Agregar fotos', vistaMisFichas);
    $('#vista').innerHTML = '<div class="aviso info">Las fotos se agregan a la visita ya enviada de <b>' + esc(f.valores['Sector'] || f.id_evento) + '</b>, sin crear otra.</div>' +
      '<div class="aviso info" style="font-weight:500">Evite rostros, sobre todo de niñas y niños.</div>' +
      '<div class="fila-btn"><label class="btn primario" style="margin:0">📷 Tomar foto<input type="file" accept="image/*" capture="environment" id="fCam" hidden></label>' +
      '<label class="btn" style="margin:0">Galería<input type="file" accept="image/*" multiple id="fGal" hidden></label></div>' +
      '<div class="fotos" id="fp" style="margin-top:12px"></div><button class="btn accion" id="subir" style="margin-top:16px">Enviar fotos</button>';
    var pintar = function () { return pintarFotos($('#fp'), f.id_visita); };
    $('#fCam').onchange = function () { agregarFotos(this.files, f.id_visita).then(function () { pintar(); }); this.value = ''; };
    $('#fGal').onchange = function () { agregarFotos(this.files, f.id_visita).then(function () { pintar(); }); this.value = ''; };
    $('#subir').onclick = function () { enviarAhora().then(pintar); };
    pintar();
  }

  // ----------------------------------------------------------------
  // Respaldo entre teléfonos
  // ----------------------------------------------------------------
  function vistaRespaldo() {
    limpiarVista(); marcar('respaldo'); titulo('Respaldo entre teléfonos', vistaInicio);
    $('#vista').innerHTML =
      '<div class="tarjeta"><h2>Exportar</h2><p>Genera un archivo con las fichas y fotos que aún no se han enviado. Páselo a otro teléfono <b>sin internet</b> con Quick Share (Android) o AirDrop (iPhone).</p>' +
      '<p class="muted">Entre Android e iPhone no hay transferencia directa: guarde el archivo en una memoria o espere a tener señal.</p>' +
      '<button class="btn primario" id="exp">Exportar respaldo</button></div>' +
      '<div class="tarjeta"><h2>Importar</h2><p>Cargue el respaldo que recibió de un compañero. Las fichas conservan el código y la hora del autor, y no se duplican si ambos teléfonos llegan a enviarlas.</p>' +
      '<label class="btn">Elegir archivo de respaldo<input type="file" accept=".json,application/json" id="imp" hidden></label><div id="msg"></div></div>';
    $('#exp').onclick = exportar;
    $('#imp').onchange = function () { if (this.files[0]) importar(this.files[0]); };
  }
  function blobABase64(b) { return new Promise(function (ok) { var r = new FileReader(); r.onload = function () { ok(String(r.result).split(',')[1]); }; r.readAsDataURL(b); }); }
  function exportar() {
    Promise.all([DB.todos('fichas'), DB.todos('fotos')]).then(function (r) {
      var fichas = r[0].filter(function (f) { return f.estado !== 'enviada'; });
      var ids = {}; r[0].forEach(function (f) { ids[f.id_visita] = true; });
      var fotos = r[1].filter(function (x) { return x.estado !== 'enviada' && ids[x.id_visita]; });
      if (!fichas.length && !fotos.length) { toast('No hay nada pendiente para respaldar'); return; }
      var fichasFotos = {}; fotos.forEach(function (x) { fichasFotos[x.id_visita] = true; });
      // fichas enviadas que tienen fotos pendientes viajan como referencia
      r[0].forEach(function (f) { if (f.estado === 'enviada' && fichasFotos[f.id_visita]) fichas.push(f); });
      return Promise.all(fotos.map(function (x) {
        return blobABase64(x.blob).then(function (b64) { var y = Object.assign({}, x); delete y.blob; y.mime = x.blob.type; y.base64 = b64; return y; });
      })).then(function (fotos64) {
        var d = new Date();
        var datos = { formato: 'respaldo-afectaciones-galapagos', version: 1, exportado: ahoraISO(), por: S.sesion.codigo, fichas: fichas, fotos: fotos64 };
        var nombre = 'respaldo-' + S.sesion.codigo + '-' + d.getFullYear() + dos(d.getMonth() + 1) + dos(d.getDate()) + '-' + dos(d.getHours()) + dos(d.getMinutes()) + '.json';
        var file = new File([JSON.stringify(datos)], nombre, { type: 'application/json' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          return navigator.share({ files: [file], title: 'Respaldo de fichas' }).catch(function () { descargar(file); });
        }
        descargar(file);
      });
    });
  }
  function descargar(file) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    toast('Respaldo guardado en Descargas');
  }
  function importar(file) {
    var r = new FileReader();
    r.onload = function () {
      var d; try { d = JSON.parse(r.result); } catch (e) { $('#msg').innerHTML = '<div class="aviso error">El archivo no es un respaldo válido.</div>'; return; }
      if (d.formato !== 'respaldo-afectaciones-galapagos') { $('#msg').innerHTML = '<div class="aviso error">El archivo no es un respaldo de esta app.</div>'; return; }
      var nf = 0, nfo = 0;
      Promise.all((d.fichas || []).map(function (f) {
        return DB.get('fichas', f.id_visita).then(function (ex) {
          if (ex) return;
          if (f.estado === 'enviando' || f.estado === 'error') f.estado = 'pendiente';
          f.importada_de = d.por; nf++;
          return DB.put('fichas', f);
        });
      })).then(function () {
        return Promise.all((d.fotos || []).map(function (x) {
          return DB.get('fotos', x.id_foto).then(function (ex) {
            if (ex) return;
            var bin = atob(x.base64), arr = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            var y = Object.assign({}, x); delete y.base64; delete y.mime; y.blob = new Blob([arr], { type: x.mime || 'image/jpeg' }); nfo++;
            return DB.put('fotos', y);
          });
        }));
      }).then(cargarDatos).then(function () {
        $('#msg').innerHTML = '<div class="aviso ok">Importadas ' + nf + ' ficha(s) y ' + nfo + ' foto(s) de ' + esc(d.por) + '. Se enviarán cuando haya señal.</div>';
        actualizarConexion(); enviarAhora(true);
      });
    };
    r.readAsText(file);
  }

  // ----------------------------------------------------------------
  // Mapa sin conexión: descarga del mapa base propio por cantón o por provincia
  // ----------------------------------------------------------------
  function geomsDe(tipo, cod) {
    return (S.parroquias ? S.parroquias.features : []).filter(function (ft) { return tipo === 'C' ? ft.properties.c === cod : ft.properties.v === cod; })
      .map(function (ft) { return ft.geometry; });
  }
  function vistaMapaOffline() {
    limpiarVista(); marcar('mapaoff'); titulo('Mapa sin conexión', vistaInicio);
    var cancelar = false, enCurso = false;
    var codIni = (S.ficha && S.ficha.valores['Código Parroquia']) || '';
    S.offProv = S.offProv || codIni.slice(0, 2); S.offCant = S.offCant || codIni.slice(0, 4);
    $('#vista').innerHTML = '<div class="tarjeta"><h2>Descargar el mapa</h2>' +
      '<p>Guarda en el teléfono el mapa base de un cantón o de una provincia para ubicarse y dibujar sin señal. Hágalo con wifi.</p>' +
      '<div class="campo"><div class="etq">Provincia</div><select id="oProv"></select></div>' +
      '<div class="campo"><div class="etq">Cantón</div><select id="oCant"></select></div>' +
      '<div id="oPlan" class="muted"></div>' +
      '<div class="fila-btn"><button class="btn primario" id="oCanton" disabled>Descargar el cantón</button><button class="btn" id="oProvBtn" disabled>Descargar la provincia</button></div>' +
      '<div id="oProg" hidden><div class="barra-progreso"><div id="bp"></div></div><p id="bpTxt" class="muted"></p><button class="btn chico" id="oCancel">Detener</button></div></div>' +
      '<div class="tarjeta"><h2>Mapas guardados en este teléfono</h2><div id="oLista"></div><p class="muted">La imagen satelital solo carga con señal. Fuera de lo descargado, el mapa se ve solo con señal.</p></div>';
    if (!S.parroquias) { $('#oPlan').innerHTML = '<div class="aviso alerta">Aún no se cargan los límites territoriales. Abra esta pantalla con señal.</div>'; }
    function pintarSel() {
      $('#oProv').innerHTML = opcionesDPA(DPA, S.offProv, 'Elegir…');
      $('#oCant').innerHTML = S.offProv ? opcionesDPA(DPA[S.offProv].c, S.offCant, 'Elegir…') : '<option value="">Primero elija la provincia</option>';
      planes();
    }
    var planC = null, planP = null;
    function planes() {
      planC = planP = null; $('#oCanton').disabled = $('#oProvBtn').disabled = true; $('#oPlan').textContent = '';
      if (!S.parroquias || !S.offProv) return;
      var pv = S.offProv, ca = S.offCant;
      var promesas = [MapaBase.planificar({ id: 'P:' + pv, prov: pv, tipo: 'Provincia', nombre: 'Provincia ' + DPA[pv].n, geoms: geomsDe('P', pv) })];
      if (ca) promesas.push(MapaBase.planificar({ id: 'C:' + ca, prov: pv, tipo: 'Cantón', nombre: 'Cantón ' + DPA[pv].c[ca].n + ' (' + DPA[pv].n + ')', geoms: geomsDe('C', ca) }));
      Promise.all(promesas).then(function (r) {
        planP = r[0]; planC = r[1] || null;
        $('#oPlan').innerHTML = (planC ? '<p>Cantón: unas ' + planC.teselas.length.toLocaleString('es') + ' piezas, aprox. <b>' + planC.mb + ' MB</b>.</p>' : '') +
          '<p>Provincia completa: unas ' + planP.teselas.length.toLocaleString('es') + ' piezas, aprox. <b>' + planP.mb + ' MB</b>.</p>';
        $('#oCanton').disabled = !planC || enCurso; $('#oProvBtn').disabled = enCurso;
      }).catch(function () { $('#oPlan').innerHTML = '<div class="aviso alerta">No se pudo leer el índice del mapa. Intente con señal.</div>'; });
    }
    function lista() {
      MapaBase.descargados().then(function (l) {
        var ver = null; MapaBase.indice().then(function (i) { ver = i.version; }).catch(function () {}).then(function () {
          $('#oLista').innerHTML = l.length ? l.map(function (a) {
            return '<div class="tarjeta" style="display:flex;gap:8px;align-items:center;padding:10px"><div style="flex:1"><b>' + esc(a.nombre) + '</b><br><span class="muted">' + fechaLegible(new Date(a.fecha).toISOString()) + ' · ' + a.mb + ' MB' +
              (a.fallidas ? ' · ' + a.fallidas + ' piezas pendientes: repita la descarga' : '') + '</span>' +
              (ver && a.version !== ver ? '<br><span class="chip amb">Hay un mapa más reciente: vuelva a descargarlo</span>' : '') + '</div>' +
              '<button class="btn chico peligro" data-borrar="' + esc(a.id) + '">Quitar</button></div>';
          }).join('') : '<p class="muted">Ninguno todavía.</p>';
          $$('[data-borrar]').forEach(function (b) {
            b.onclick = function () {
              confirmar('¿Quitar este mapa del teléfono?', 'Quitar').then(function (ok) { if (ok) MapaBase.borrar(b.getAttribute('data-borrar')).then(lista); });
            };
          });
        });
      });
    }
    function bajar(plan) {
      if (!navigator.onLine) return toast('Se necesita señal');
      var hacer = function () {
        enCurso = true; cancelar = false;
        $('#oCanton').disabled = $('#oProvBtn').disabled = true; $('#oProg').hidden = false;
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
        MapaBase.descargar(plan, function (h, t, fall) {
          if (!$('#bp')) return;
          $('#bp').style.width = (100 * h / t) + '%';
          $('#bpTxt').textContent = h.toLocaleString('es') + ' de ' + t.toLocaleString('es') + (fall ? ' · ' + fall + ' fallidas' : '');
        }, function () { return cancelar; }).then(function (r) {
          enCurso = false;
          if (!$('#oProg')) return;
          $('#oProg').hidden = true; planes(); lista();
          toast(r.cancelado ? 'Descarga detenida. Puede retomarla: lo ya bajado se conserva.' : r.fallidas ? 'Mapa guardado con ' + r.fallidas + ' piezas fallidas. Repita para completarlo.' : 'Mapa guardado: ' + plan.area.nombre);
        });
      };
      // Aviso si el teléfono tiene poco espacio
      if (navigator.storage && navigator.storage.estimate) {
        navigator.storage.estimate().then(function (e) {
          var libreMB = (e.quota - e.usage) / 1048576;
          if (libreMB < plan.mb * 1.5) confirmar('El teléfono tiene poco espacio disponible para la app (unos ' + Math.round(libreMB) + ' MB). ¿Intentar igual?', 'Intentar').then(function (ok) { if (ok) hacer(); });
          else hacer();
        }).catch(hacer);
      } else hacer();
    }
    $('#oProv').onchange = function () { S.offProv = this.value; S.offCant = ''; pintarSel(); };
    $('#oCant').onchange = function () { S.offCant = this.value; planes(); };
    $('#oCanton').onclick = function () { if (planC) bajar(planC); };
    $('#oProvBtn').onclick = function () {
      if (!planP) return;
      confirmar('La provincia completa pesa unos ' + planP.mb + ' MB y puede tardar varios minutos. ¿Descargar?', 'Descargar').then(function (ok) { if (ok) bajar(planP); });
    };
    $('#oCancel').onclick = function () { cancelar = true; };
    S.detenerExtra = function () { cancelar = true; };
    pintarSel(); lista();
  }

  // ----------------------------------------------------------------
  // Arranque
  // ----------------------------------------------------------------
  // Errores inesperados de la app: se informan al servidor (como máximo 5 por sesión) para el registro de errores
  var erroresInformados = 0;
  function informarError(donde, msg) {
    if (erroresInformados >= 5 || !CONFIG.BACKEND_URL) return;
    erroresInformados++;
    var cuerpo = { accion: 'reportarError', donde: donde, mensaje: String(msg).slice(0, 1500), version: CONFIG.VERSION, correo: S.sesion ? S.sesion.correo : '' };
    if (navigator.onLine) Sync.post(cuerpo, 15000).catch(function () {});
  }
  window.addEventListener('error', function (e) { informarError('pagina', (e.message || '') + ' @ ' + (e.filename || '') + ':' + (e.lineno || '')); });
  window.addEventListener('unhandledrejection', function (e) { var r = e.reason; informarError('promesa', r && (r.stack || r.message) || r); });

  function arrancar() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
    window.addEventListener('online', function () { actualizarConexion(); if (S.sesion) reintentarLuego(1, 15); });
    window.addEventListener('offline', actualizarConexion);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && S.sesion && vistaActual !== 'ficha') enviarAhora(true);
    });
    setInterval(function () {
      if (!S.sesion || !navigator.onLine || document.visibilityState !== 'visible') return;
      var hay = S.fichas.some(function (f) { return f.estado === 'pendiente'; });
      var vieja = !S.eventosHora || Date.now() - S.eventosHora > 15 * 60e3;
      if (hay || vieja) enviarAhora(true);
    }, 60000);
    if (typeof BroadcastChannel !== 'undefined') {
      new BroadcastChannel('sync-afectaciones').onmessage = function (e) {
        if (e.data.tipo === 'fin' || e.data.tipo === 'eventos') cargarDatos().then(actualizarConexion);
      };
    }
    fetch('datos/parroquias.geojson').then(function (r) { return r.ok ? r.json() : null; }).then(function (g) { S.parroquias = g; }).catch(function () {});

    if (!estaInstalada()) { vistaInstalar(); return; }
    cargarDatos().then(function () {
      actualizarConexion();
      if (!S.sesion) return vistaAcceso();
      vistaInicio();
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
      enviarAhora(true);
    });
  }
  arrancar();

  // Acceso para pruebas automáticas
  window.__app = { S: S, vistaPaso: vistaPaso, nuevaFicha: nuevaFicha, cargarDatos: cargarDatos, listaEventos: listaEventos, vistaInicio: vistaInicio, aceptarUbicacion: aceptarUbicacion };
})();
