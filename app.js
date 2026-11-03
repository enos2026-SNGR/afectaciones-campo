/* App de campo: registro de afectaciones por inundaciones, Galápagos */
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
    return 'GAL-' + d.getFullYear() + dos(d.getMonth() + 1) + dos(d.getDate()) + '-' + dos(d.getHours()) + dos(d.getMinutes()) + '-' + uuid().slice(0, 4).toUpperCase();
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
  var COLOR_ESTADO = { 'En curso': '#d62728', 'En atención': '#ff7f0e', 'Estabilizado': '#1f77b4', 'Cerrado': '#7f7f7f' };

  // ----------------------------------------------------------------
  // Estado de la app
  // ----------------------------------------------------------------
  var S = {
    sesion: null, eventos: [], eventosHora: null, fichas: [], parroquias: null,
    ficha: null, paso: 1, mapa: null, gpsWatch: null, pila: []
  };
  var VACIO = {};
  var LISTAS = ['Origen', 'Nivel del Agua', 'Tendencia del Agua', 'Estado del Evento', 'Solicitud de Cierre',
    'Agua Potable', 'Alcantarillado o Pozos Sépticos', 'Energía Eléctrica', 'Telefonía e Internet', 'Vía de Acceso',
    'Funcionamiento Edificaciones Públicas', 'Funcionamiento Muelles', 'Justificación de Baja', 'Cantón', 'Parroquia', 'Sector', 'Descripción'];
  var CIFRAS = Object.keys(ETIQUETAS);
  var MULTI = ['Grupos Prioritarios', 'Necesidades Inmediatas'];
  LISTAS.forEach(function (k) { VACIO[k] = ''; });
  CIFRAS.forEach(function (k) { VACIO[k] = ''; });
  MULTI.forEach(function (k) { VACIO[k] = []; });

  function cargarDatos() {
    return Promise.all([DB.kvGet('sesion'), DB.kvGet('eventos'), DB.kvGet('eventosHora'), DB.todos('fichas')]).then(function (r) {
      S.sesion = r[0] || null; S.eventos = r[1] || []; S.eventosHora = r[2] || null; S.fichas = r[3] || [];
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
    return { tipo: g.tipo, geojson: g.tipo === 'Área inundada' ? { type: 'Polygon', coordinates: [g.coordenadas.concat([g.coordenadas[0]])] } : { type: 'LineString', coordinates: g.coordenadas } };
  }
  function geomDeServidor(g) {
    var c = g.tipo === 'Área inundada' ? g.geojson.coordinates[0].slice(0, -1) : g.geojson.coordinates;
    return { id: uuid(), tipo: g.tipo, coordenadas: c, precargada: true };
  }

  // ----------------------------------------------------------------
  // Navegación
  // ----------------------------------------------------------------
  function titulo(t, volver) {
    $('#titulo').textContent = t;
    $('#btnVolver').hidden = !volver;
    $('#btnVolver').onclick = volver || null;
  }
  function limpiarVista() {
    detenerGPS();
    if (S.detenerExtra) { S.detenerExtra(); S.detenerExtra = null; }
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
    limpiarVista(); titulo('Instalar la app');
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    $('#vista').innerHTML =
      '<div class="aviso alerta">Para registrar afectaciones la app debe estar instalada en la pantalla de inicio. Así abre sin señal y el teléfono no borra las fichas guardadas.</div>' +
      '<div class="tarjeta"><h2>' + (ios ? 'En iPhone (Safari)' : 'En Android (Chrome)') + '</h2>' +
      (ios ? '<ol><li>Toque el botón <b>Compartir</b> (cuadro con flecha hacia arriba).</li><li>Elija <b>Agregar a pantalla de inicio</b>.</li><li>Toque <b>Agregar</b> y abra la app desde el nuevo ícono.</li></ol>'
           : '<button class="btn primario" id="btnInstalar" ' + (promptInstalar ? '' : 'hidden') + '>Instalar ahora</button>' +
             '<ol><li>Toque el menú <b>⋮</b> del navegador.</li><li>Elija <b>Instalar app</b> o <b>Agregar a pantalla de inicio</b>.</li><li>Abra la app desde el nuevo ícono.</li></ol>') +
      '</div><p class="muted">Abra esta página con señal la primera vez, para que la app quede guardada en el teléfono.</p>';
    var b = $('#btnInstalar');
    if (b) b.onclick = function () { if (promptInstalar) { promptInstalar.prompt(); promptInstalar.userChoice.then(function () { promptInstalar = null; }); } };
  }

  function vistaAcceso() {
    limpiarVista(); titulo('Acceso del técnico');
    $('#vista').innerHTML =
      '<div class="tarjeta"><h2>Ingrese su código</h2><p class="muted">El coordinador le asigna el código. La primera vez se necesita señal para validarlo.</p>' +
      '<div class="campo"><input type="text" id="codigo" autocapitalize="characters" autocomplete="off" placeholder="Código del técnico"></div>' +
      '<button class="btn primario" id="entrar">Entrar</button><div id="msg" style="margin-top:12px"></div></div>' +
      (CONFIG.BACKEND_URL ? '' : '<div class="aviso error">La app aún no tiene configurado el servidor. Avise al coordinador.</div>');
    $('#entrar').onclick = function () {
      var c = $('#codigo').value.trim().toUpperCase();
      if (!c) return;
      if (!navigator.onLine) { $('#msg').innerHTML = '<div class="aviso alerta">Sin señal. Intente cuando tenga conexión.</div>'; return; }
      $('#entrar').disabled = true; $('#msg').innerHTML = '<p class="muted">Validando…</p>';
      Sync.post({ accion: 'validarTecnico', codigo: c }).then(function (r) {
        if (!r.ok) throw new Error(r.error);
        S.sesion = { codigo: r.codigo, nombre: r.nombre, desde: Date.now() };
        return DB.kvSet('sesion', S.sesion);
      }).then(function () {
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
        return Sync.sincronizar();
      }).then(function () { return cargarDatos(); }).then(vistaInicio).catch(function (e) {
        $('#entrar').disabled = false;
        $('#msg').innerHTML = '<div class="aviso error">' + esc(e.message || 'No se pudo validar') + '</div>';
      });
    };
  }

  // ----------------------------------------------------------------
  // Inicio
  // ----------------------------------------------------------------
  function vistaInicio() {
    limpiarVista(); marcar('inicio'); S.pila = []; titulo('Afectaciones Galápagos');
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
    if (errs.length) h += '<div class="aviso error">' + errs.length + ' ficha(s) con error que requieren su revisión.<button class="btn chico" data-ir="mis">Revisar</button></div>';
    if (borrViejo) h += '<div class="aviso alerta">Tiene borradores sin enviar desde hace más de ' + CONFIG.BORRADOR_RECORDATORIO_H + ' hora. Esa información no llega al COE hasta que la envíe.<button class="btn chico" data-ir="mis">Ver borradores</button></div>';
    if (pendViejo) h += '<div class="aviso alerta">Hay fichas sin enviar desde hace más de ' + CONFIG.RESPALDO_SUGERIDO_H + ' horas. Exporte un respaldo a otro teléfono por si este se pierde o se daña.<button class="btn chico" data-ir="respaldo">Exportar respaldo</button></div>';
    if (rechazos.length) h += '<div class="aviso info">El coordinador rechazó el cierre de ' + rechazos.length + ' evento(s). Revise el motivo en la lista de eventos.</div>';

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
      '<p class="muted" style="margin-top:12px">Técnico: <b>' + esc(S.sesion.codigo) + '</b> ' + esc(S.sesion.nombre || '') + '</p>' +
      '<button class="btn peligro chico" id="salir">Cerrar sesión</button></div>';
    $('#vista').innerHTML = h;

    $('#nuevo').onclick = function () { nuevaFicha('INICIAL'); };
    $('#actualizar').onclick = vistaElegirEvento;
    $('#enviarYa').onclick = function () { enviarAhora(); };
    $('#salir').onclick = function () {
      var hay = S.fichas.some(function (f) { return f.estado !== 'enviada'; });
      confirmar(hay ? 'Hay fichas sin enviar. Se conservarán en el teléfono. ¿Cerrar sesión?' : '¿Cerrar sesión?', 'Cerrar sesión').then(function (ok) {
        if (!ok) return; DB.kvSet('sesion', null).then(function () { S.sesion = null; vistaAcceso(); });
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
        if (ultimaPos) L.circleMarker([ultimaPos.lat, ultimaPos.lon], { radius: 7, color: '#0b4f8a', fillColor: '#60a5fa', fillOpacity: 1 }).addTo(S.mapa);
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
      creada: ahoraISO(), actualizada: ahoraISO(), fecha_observacion: ahoraISO(), paso: 1,
      valores: clon(VACIO), ubicacion: null, geometrias: [], evento_vinculado: '', base: null
    };
    if (tipo === 'INICIAL') {
      f.id_evento = idEvento();
    } else if (tipo === 'ACTUALIZACION') {
      f.id_evento = evento.id_evento;
      f.valores = Object.assign(clon(VACIO), clon(evento.valores || {}));
      f.valores['Solicitud de Cierre'] = ''; f.valores['Justificación de Baja'] = ''; f.valores['Descripción'] = '';
      f.valores['Cantón'] = evento.canton; f.valores['Parroquia'] = evento.parroquia; f.valores['Sector'] = evento.sector;
      f.base = clon(f.valores);
      f.ubicacion = { lat: evento.lat, lon: evento.lon, precision: null, metodo: evento.metodo || 'GPS', delEvento: true };
      f.geometrias = (evento.geometrias || []).map(geomDeServidor);
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
      f.geometrias_base = JSON.stringify(f.geometrias.map(function (g) { return [g.tipo, g.coordenadas]; }));
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
    S.paso = paso || f.paso || 1;
    guardar().then(function () { vistaPaso(S.paso); });
  }

  // ----------------------------------------------------------------
  // Asistente de pasos
  // ----------------------------------------------------------------
  var PASOS = [
    { t: 'Ubicación', f: pasoUbicacion },
    { t: 'Evento', f: pasoEvento },
    { t: 'Personas y viviendas', f: pasoPersonas },
    { t: 'Servicios e infraestructura', f: pasoServicios },
    { t: 'Medios de vida y necesidades', f: pasoMedios },
    { t: 'Mapa', f: pasoMapa },
    { t: 'Fotos y envío', f: pasoEnvio }
  ];
  function nombreTipo(f) {
    return f.tipo === 'INICIAL' ? 'Evento nuevo' : f.tipo === 'ACTUALIZACION' ? 'Actualización' : 'Corrección';
  }
  function vistaPaso(n) {
    limpiarVista(); marcar('ficha');
    S.paso = n;
    var f = S.ficha;
    titulo(nombreTipo(f) + ' · ' + n + '/7', function () { guardar().then(vistaInicio); toast('Borrador guardado'); });
    var prog = '<div class="progreso">' + PASOS.map(function (p, i) { return '<span class="' + (i < n ? 'hecho' : '') + '"></span>'; }).join('') + '</div>';
    var cab = '';
    if (f.tipo !== 'INICIAL') {
      cab = '<div class="aviso info">' + (f.tipo === 'ACTUALIZACION' ? 'Actualiza el evento' : 'Corrige su visita del evento') + ' <b>' + esc(f.valores['Sector'] || f.id_evento) + '</b>. ' +
        (f.tipo === 'ACTUALIZACION' ? 'Los valores vienen de la última visita: cambie solo lo que cambió.' : 'Cambie solo los datos que estaban errados.') + '</div>';
      if (f.evento_ref && f.evento_ref.cierre === 'RECHAZADO') cab += '<div class="aviso alerta">El coordinador rechazó el cierre: ' + esc(f.evento_ref.rechazo) + '.</div>';
    }
    $('#vista').innerHTML = prog + '<h2 class="paso-titulo">' + PASOS[n - 1].t + '</h2>' + cab + '<div id="cuerpo"></div>';
    PASOS[n - 1].f($('#cuerpo'));
    $('#navpasos').innerHTML = '<div class="navpasos">' +
      (n > 1 ? '<button class="btn" id="ant">‹ Atrás</button>' : '<button class="btn" id="ant">Salir</button>') +
      (n < 7 ? '<button class="btn primario" id="sig">Siguiente ›</button>' : '') + '</div>';
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
  function pasoUbicacion(cuerpo) {
    var f = S.ficha;
    var h = '';
    if (f.tipo === 'ACTUALIZACION') {
      h += '<div class="tarjeta"><b>' + esc(f.valores['Parroquia']) + ', ' + esc(f.valores['Cantón']) + '</b><br><span class="muted">La ubicación del evento ya está registrada.</span></div>';
      cuerpo.innerHTML = h + campoTexto('Sector', 'Sector o barrio', 'Ej.: Barrio Las Ninfas, calle Charles Binford');
      enlazarTexto(cuerpo);
      return;
    }
    h += '<div id="gps"></div>';
    var cantones = Object.keys(CATALOGOS.parroquias);
    h += '<div class="campo"><div class="etq">Cantón <span class="oblig">*</span></div><select id="selCanton"><option value="">Elegir…</option>' +
      cantones.map(function (c) { return '<option' + (f.valores['Cantón'] === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></div>' +
      '<div class="campo"><div class="etq">Parroquia <span class="oblig">*</span></div><select id="selParroquia"></select><p class="muted" id="msgParr"></p></div>' +
      campoTexto('Sector', 'Sector o barrio', 'Ej.: Barrio Las Ninfas, calle Charles Binford');
    cuerpo.innerHTML = h;
    enlazarTexto(cuerpo);
    function llenarParroquias() {
      var c = f.valores['Cantón'];
      var ps = CATALOGOS.parroquias[c] || [];
      $('#selParroquia').innerHTML = '<option value="">' + (c ? 'Elegir…' : 'Primero elija el cantón') + '</option>' +
        ps.map(function (p) { return '<option' + (f.valores['Parroquia'] === p ? ' selected' : '') + '>' + p + '</option>'; }).join('');
    }
    llenarParroquias();
    $('#selCanton').onchange = function () { cambiar('Cantón', this.value); cambiar('Parroquia', ''); llenarParroquias(); };
    $('#selParroquia').onchange = function () { cambiar('Parroquia', this.value); };
    pintarGPS();
    if (f.tipo === 'INICIAL' && !(f.ubicacion && f.ubicacion.aceptada)) iniciarGPS();
  }

  function campoTexto(campo, etiqueta, ph) {
    return '<div class="campo"><label for="t-' + esc(campo) + '">' + esc(etiqueta) + '</label>' +
      '<input type="text" id="t-' + esc(campo) + '" data-texto="' + esc(campo) + '" value="' + esc(S.ficha.valores[campo]) + '" placeholder="' + esc(ph || '') + '" autocomplete="off">' +
      '<p class="muted">Puede dictar con el micrófono del teclado.</p></div>';
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
    if (f.tipo === 'INICIAL') revisarCercanos();
  }
  function pintarGPS() {
    var d = $('#gps'); if (!d) return;
    var f = S.ficha, u = f.ubicacion, e = S.gpsEstado || {};
    if (u && u.aceptada) {
      d.innerHTML = '<div class="gps bueno"><div class="prec">✓ ' + (u.metodo === 'GPS' ? Math.round(u.precision) + ' m' : 'Punto manual') + '</div>' +
        '<div>' + u.lat.toFixed(5) + ', ' + u.lon.toFixed(5) + '</div>' +
        '<div class="fila-btn" style="margin-top:10px"><button class="btn chico" id="gpsOtra">Volver a ubicar</button><button class="btn chico" id="gpsMapa">Ajustar en el mapa</button></div></div>';
      $('#gpsOtra').onclick = function () { f.ubicacion = null; guardar(); iniciarGPS(); pintarGPS(); };
      $('#gpsMapa').onclick = marcarEnMapa;
      return;
    }
    var seg = e.inicio ? Math.round((Date.now() - e.inicio) / 1000) : 0;
    var prec = e.mejor ? Math.round(e.mejor.precision) : null;
    var h = '<div class="gps ' + (prec != null ? 'malo' : '') + '"><div class="muted">Precisión del GPS</div><div class="prec">' + (prec != null ? prec + ' m' : '…') + '</div>' +
      '<div class="muted">Se acepta automáticamente al bajar de ' + CONFIG.PRECISION_ACEPTABLE_M + ' m · ' + seg + ' s</div>' +
      (e.error ? '<div class="aviso alerta" style="margin-top:8px">' + esc(e.error) + '</div>' : '') +
      '<p class="muted">Consejo: salga a un espacio abierto, lejos de muros y techos.</p>';
    if (seg >= CONFIG.ESPERA_GPS_S || e.error) {
      h += '<div class="fila-btn">' + (prec != null ? '<button class="btn chico" id="gpsUsar">Usar ' + prec + ' m</button>' : '') +
        '<button class="btn chico primario" id="gpsMapa">Marcar en el mapa</button></div><button class="btn chico" id="gpsEsperar" style="margin-top:8px">Seguir esperando</button>';
    } else {
      h += '<button class="btn chico" id="gpsMapa">Marcar en el mapa</button>';
    }
    d.innerHTML = h + '</div>';
    $('#gpsMapa').onclick = marcarEnMapa;
    if ($('#gpsUsar')) $('#gpsUsar').onclick = function () { aceptarUbicacion(e.mejor, 'GPS'); };
    if ($('#gpsEsperar')) $('#gpsEsperar').onclick = function () { e.inicio = Date.now(); e.error = null; if (S.gpsWatch == null) iniciarGPS(); pintarGPS(); };
  }
  function marcarEnMapa() {
    detenerGPS();
    var f = S.ficha;
    var m = modal('<h2>Toque el mapa en el sitio afectado</h2><div class="mapa" id="mMapa"></div><p class="muted" id="mPos">Sin punto marcado.</p>' +
      '<div class="fila-btn"><button class="btn" id="mNo">Cancelar</button><button class="btn primario" id="mSi" disabled>Usar este punto</button></div>');
    var centro = f.ubicacion ? [f.ubicacion.lat, f.ubicacion.lon] : (S.gpsEstado && S.gpsEstado.mejor ? [S.gpsEstado.mejor.lat, S.gpsEstado.mejor.lon] : [-0.745, -90.313]);
    var mapa = crearMapa($('#mMapa', m), centro, 16);
    var punto = null, marcador = null;
    mapa.on('click', function (ev) {
      punto = { lat: ev.latlng.lat, lon: ev.latlng.lng };
      if (marcador) marcador.setLatLng(ev.latlng); else marcador = L.marker(ev.latlng).addTo(mapa);
      $('#mPos', m).textContent = punto.lat.toFixed(5) + ', ' + punto.lon.toFixed(5);
      $('#mSi', m).disabled = false;
    });
    $('#mNo', m).onclick = function () { mapa.remove(); cerrarModal(); if (!(f.ubicacion && f.ubicacion.aceptada)) iniciarGPS(); pintarGPS(); };
    $('#mSi', m).onclick = function () { mapa.remove(); cerrarModal(); aceptarUbicacion(punto, 'Manual'); };
  }
  function detectarTerritorio(lat, lon) {
    var f = S.ficha, canton = '', parroquia = '';
    if (S.parroquias) {
      S.parroquias.features.forEach(function (ft) {
        var g = ft.geometry, polis = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
        polis.forEach(function (p) { if (puntoEnAnillo(lon, lat, p[0])) { canton = ft.properties.canton; parroquia = ft.properties.parroquia; } });
      });
    }
    if (!canton) ISLAS.forEach(function (i) { var c = i.caja; if (lon >= c[0] && lon <= c[2] && lat >= c[1] && lat <= c[3]) canton = i.canton; });
    if (canton) {
      f.valores['Cantón'] = canton;
      if (parroquia) f.valores['Parroquia'] = parroquia;
      else if ((CATALOGOS.parroquias[canton] || []).indexOf(f.valores['Parroquia']) < 0) f.valores['Parroquia'] = '';
      if ($('#selCanton')) {
        $('#selCanton').value = canton;
        var ps = CATALOGOS.parroquias[canton];
        $('#selParroquia').innerHTML = '<option value="">Elegir…</option>' + ps.map(function (p) { return '<option' + (f.valores['Parroquia'] === p ? ' selected' : '') + '>' + p + '</option>'; }).join('');
        $('#msgParr').textContent = parroquia ? 'Detectada con el GPS. Corríjala si no es correcta.' : 'Cantón detectado por la isla. Elija la parroquia.';
      }
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
  function pasoEvento(cuerpo) {
    var f = S.ficha;
    var h = campoOpciones('Origen', CATALOGOS['Origen'], 'Origen observado') +
      campoOpciones('Nivel del Agua', CATALOGOS['Nivel del Agua'], 'Nivel del agua', { una: true }) +
      campoOpciones('Tendencia del Agua', CATALOGOS['Tendencia del Agua'], 'Tendencia del agua') +
      campoOpciones('Estado del Evento', CATALOGOS['Estado del Evento'], 'Estado del evento', { oblig: true, info: 'estado' });
    if (f.tipo !== 'CORRECCION') {
      h += '<div class="tarjeta"><div class="etq" style="display:flex;gap:8px;align-items:center;font-weight:650">¿Solicitar el cierre del evento? ' + botonInfo('cierre') + '</div>' +
        '<p class="muted">Solo si ya no hay afectación vigente. El coordinador lo confirma.</p>' +
        campoOpciones('Solicitud de Cierre', CATALOGOS['Solicitud de Cierre'], 'Motivo', { una: true }) + '</div>';
    }
    h += '<div class="campo"><label for="t-desc">Descripción del evento</label><textarea id="t-desc" data-texto="Descripción" placeholder="Qué se observa en el sitio. Puede dictar con el micrófono del teclado.">' + esc(f.valores['Descripción']) + '</textarea></div>';
    cuerpo.innerHTML = h;
    enlazarOpciones(cuerpo);
    enlazarTexto(cuerpo);
  }

  // ---------------- Paso 3: Personas y viviendas ----------------
  function pasoPersonas(cuerpo) {
    var h = '<p class="paso-sub">Cada cifra inicia en "Sin dato". Toque <b>Ninguno</b> para registrar un cero verificado. ' + botonInfo('cifras') + '</p>' +
      '<div id="avisosP"></div>' +
      '<h3 style="display:flex;gap:8px;align-items:center">Personas y familias ' + botonInfo('personas') + '</h3>' +
      ['Familias Afectadas', 'Personas Afectadas Directamente', 'Familias Damnificadas', 'Personas Damnificadas',
       'Personas Evacuadas', 'Personas Albergadas', 'Personas en Familias Acogientes',
       'Personas Heridas', 'Personas Fallecidas', 'Personas Desaparecidas'].map(function (c) { return contador(c); }).join('') +
      '<div class="tarjeta" id="impact"></div>' +
      campoMulti('Grupos Prioritarios', CATALOGOS['Grupos Prioritarios'], 'Grupos prioritarios presentes en el sitio') +
      '<h3 style="display:flex;gap:8px;align-items:center">Viviendas ' + botonInfo('viviendas') + '</h3>' +
      contador('Viviendas Afectadas') + contador('Viviendas Inhabitables') +
      '<div id="bajaCont"></div>';
    cuerpo.innerHTML = h;
    function refrescar() {
      var v = S.ficha.valores;
      var pi = suma(v['Personas Afectadas Directamente'], v['Personas Damnificadas']);
      var fi = suma(v['Familias Afectadas'], v['Familias Damnificadas']);
      $('#impact').innerHTML = '<b>Impactadas (calculado)</b><br>Personas: ' + (pi === '' ? 'sin dato' : pi) + ' · Familias: ' + (fi === '' ? 'sin dato' : fi);
      $('#avisosP').innerHTML = advertencias().map(function (a) { return '<div class="aviso alerta">' + esc(a) + '</div>'; }).join('');
      pintarBaja($('#bajaCont'));
    }
    enlazarContadores(cuerpo, refrescar);
    enlazarOpciones(cuerpo);
    refrescar();
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
    cuerpo.innerHTML = '<h3>Medios de vida</h3>' + contador('Cultivos Afectados (ha)', { paso: 0.5 }) +
      contador('Ganado Afectado') + contador('Aves de Corral Afectadas') +
      contador('Comercios Afectados') + contador('Servicios Turísticos Afectados') + contador('Embarcaciones de Pesca Afectadas') +
      campoMulti('Necesidades Inmediatas', CATALOGOS['Necesidades Inmediatas'], 'Necesidades inmediatas');
    enlazarContadores(cuerpo);
    enlazarOpciones(cuerpo);
  }

  // ---------------- Paso 6: Mapa ----------------
  function crearMapa(div, centro, zoom) {
    var mapa = L.map(div, { zoomControl: true, attributionControl: true, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false });
    var base = L.tileLayer(CONFIG.TESELAS_BASE, { subdomains: CONFIG.TESELAS_BASE_SUB, maxZoom: 19, maxNativeZoom: 18, attribution: CONFIG.TESELAS_BASE_ATRIB, crossOrigin: true }).addTo(mapa);
    var sat = L.tileLayer(CONFIG.TESELAS_SATELITE, { maxZoom: 19, maxNativeZoom: 18, attribution: CONFIG.TESELAS_SATELITE_ATRIB });
    var capas = { 'Mapa base': base, 'Satélite (requiere señal)': sat };
    var extra = {};
    if (S.parroquias) {
      extra['Límites parroquiales'] = L.geoJSON(S.parroquias, { style: { color: '#334155', weight: 2, dashArray: '6 4', fill: false }, interactive: false }).addTo(mapa);
    }
    L.control.layers(capas, extra, { collapsed: true }).addTo(mapa);
    mapa.setView(centro || [-0.745, -90.313], zoom || 15);
    return mapa;
  }
  function agregarLeyenda(mapa) {
    var c = L.control({ position: 'bottomleft' });
    c.onAdd = function () {
      var d = L.DomUtil.create('div', 'leyenda-mapa');
      d.innerHTML = Object.keys(COLOR_ESTADO).map(function (k) { return '<i style="background:' + COLOR_ESTADO[k] + '"></i>' + k; }).join('<br>');
      return d;
    };
    c.addTo(mapa);
  }
  function pasoMapa(cuerpo) {
    var f = S.ficha;
    cuerpo.innerHTML = '<p class="paso-sub">Opcional. Dibuje el área inundada y los tramos de vía afectados. El punto del sitio ya está registrado.</p>' +
      '<div class="mapa" id="mapaFicha"></div><div id="herr"></div><div id="geoms"></div>';
    var u = f.ubicacion;
    var mapa = S.mapa = crearMapa($('#mapaFicha'), u ? [u.lat, u.lon] : null, 17);
    agregarLeyenda(mapa);
    var capaOtros = L.layerGroup().addTo(mapa), capaFicha = L.layerGroup().addTo(mapa), capaTemp = L.layerGroup().addTo(mapa);
    listaEventos().forEach(function (e) {
      if (e.id_evento === f.id_evento) return;
      if (u && distancia(u.lat, u.lon, e.lat, e.lon) > 3000) return;
      L.circleMarker([e.lat, e.lon], { radius: 8, color: '#fff', weight: 2, fillColor: COLOR_ESTADO[e.estado] || '#555', fillOpacity: .9 })
        .bindTooltip(esc(e.sector || e.parroquia)).addTo(capaOtros);
      (e.geometrias || []).forEach(function (g) {
        L.geoJSON(g.geojson, { style: { color: COLOR_ESTADO[e.estado] || '#555', weight: 2, fillOpacity: .12, dashArray: '4 4' }, interactive: false }).addTo(capaOtros);
      });
    });
    var modo = null, verts = [], caminar = null;

    function pintarFicha() {
      capaFicha.clearLayers();
      var color = COLOR_ESTADO[f.valores['Estado del Evento']] || '#0b4f8a';
      if (u) L.circleMarker([u.lat, u.lon], { radius: 9, color: '#fff', weight: 3, fillColor: color, fillOpacity: 1 }).addTo(capaFicha);
      f.geometrias.forEach(function (g) {
        var ll = g.coordenadas.map(function (c) { return [c[1], c[0]]; });
        if (g.tipo === 'Área inundada') L.polygon(ll, { color: color, weight: 3, fillOpacity: .25 }).addTo(capaFicha);
        else L.polyline(ll, { color: color, weight: 7, opacity: .9 }).addTo(capaFicha);
      });
      var lista = f.geometrias.map(function (g, i) {
        var med = g.tipo === 'Área inundada' ? 'Área ' + Math.round(areaM2(g.coordenadas)).toLocaleString('es') + ' m²' : 'Longitud ' + metros(longitud(g.coordenadas));
        return '<div class="tarjeta" style="display:flex;align-items:center;gap:10px;padding:10px"><div style="flex:1"><b>' + esc(g.tipo) + '</b><br><span class="muted">' + med + '</span></div>' +
          '<button class="btn chico peligro" data-quitar="' + i + '">Quitar</button></div>';
      }).join('');
      $('#geoms').innerHTML = lista;
      $$('[data-quitar]').forEach(function (b) {
        b.onclick = function () {
          confirmar('¿Quitar esta geometría?', 'Quitar').then(function (ok) {
            if (!ok) return; f.geometrias.splice(Number(b.getAttribute('data-quitar')), 1); guardar(); pintarFicha();
          });
        };
      });
    }
    function pintarTemp() {
      capaTemp.clearLayers();
      var ll = verts.map(function (c) { return [c[1], c[0]]; });
      ll.forEach(function (p) { L.circleMarker(p, { radius: 5, color: '#0b4f8a', fillColor: '#fff', fillOpacity: 1 }).addTo(capaTemp); });
      if (ll.length > 1) (modo === 'tramo' ? L.polyline(ll, { color: '#0b4f8a', weight: 6 }) : L.polygon(ll, { color: '#0b4f8a', weight: 3, dashArray: '6 4', fillOpacity: .15 })).addTo(capaTemp);
    }
    function herramientas() {
      var h;
      if (!modo) {
        var tieneArea = f.geometrias.some(function (g) { return g.tipo === 'Área inundada'; });
        h = '<div class="herr"><button class="btn" id="hArea">' + (tieneArea ? 'Redibujar área' : 'Dibujar área inundada') + '</button>' +
          '<button class="btn" id="hTramo">Agregar tramo de vía</button><button class="btn" id="hCaminar" style="grid-column:1/-1">Trazar el área caminando el borde</button></div>';
      } else if (modo === 'caminar') {
        h = '<div class="aviso info">Camine por el borde del área. Puntos tomados: <b id="nPts">' + verts.length + '</b>. Se descartan los de precisión peor que ' + CONFIG.PRECISION_ACEPTABLE_M + ' m.</div>' +
          '<div class="herr"><button class="btn" id="hCancelar">Cancelar</button><button class="btn primario" id="hTerminar">Terminar</button></div>';
      } else {
        h = '<div class="aviso info">' + (modo === 'area' ? 'Toque el mapa en cada esquina del área inundada.' : 'Toque el mapa a lo largo del tramo de vía afectado.') + ' Puntos: <b>' + verts.length + '</b></div>' +
          '<div class="herr"><button class="btn" id="hDeshacer"' + (verts.length ? '' : ' disabled') + '>Deshacer último</button><button class="btn" id="hCancelar">Cancelar</button>' +
          '<button class="btn primario" id="hTerminar" style="grid-column:1/-1"' + (verts.length >= (modo === 'area' ? 3 : 2) ? '' : ' disabled') + '>Terminar</button></div>';
      }
      $('#herr').innerHTML = h;
      if ($('#hArea')) $('#hArea').onclick = function () { modo = 'area'; verts = []; herramientas(); };
      if ($('#hTramo')) $('#hTramo').onclick = function () { modo = 'tramo'; verts = []; herramientas(); };
      if ($('#hCaminar')) $('#hCaminar').onclick = iniciarCaminata;
      if ($('#hDeshacer')) $('#hDeshacer').onclick = function () { verts.pop(); pintarTemp(); herramientas(); };
      if ($('#hCancelar')) $('#hCancelar').onclick = function () { terminarCaminata(); modo = null; verts = []; pintarTemp(); herramientas(); };
      if ($('#hTerminar')) $('#hTerminar').onclick = terminar;
    }
    function terminar() {
      var tipo = modo === 'tramo' ? 'Tramo de vía' : 'Área inundada';
      terminarCaminata();
      if (verts.length < (tipo === 'Área inundada' ? 3 : 2)) { toast('Faltan puntos'); return; }
      if (tipo === 'Área inundada') f.geometrias = f.geometrias.filter(function (g) { return g.tipo !== 'Área inundada'; });
      f.geometrias.push({ id: uuid(), tipo: tipo, coordenadas: verts.map(function (c) { return [Number(c[0].toFixed(6)), Number(c[1].toFixed(6))]; }) });
      modo = null; verts = []; guardar(); pintarTemp(); pintarFicha(); herramientas();
    }
    function iniciarCaminata() {
      modo = 'caminar'; verts = [];
      caminar = navigator.geolocation.watchPosition(function (p) {
        var c = p.coords; if (c.accuracy > CONFIG.PRECISION_ACEPTABLE_M) return;
        var ult = verts[verts.length - 1];
        if (ult && distancia(ult[1], ult[0], c.latitude, c.longitude) < 3) return;
        verts.push([c.longitude, c.latitude]); pintarTemp();
        if ($('#nPts')) $('#nPts').textContent = verts.length;
        mapa.panTo([c.latitude, c.longitude]);
      }, function () {}, { enableHighAccuracy: true, maximumAge: 0 });
      herramientas();
    }
    function terminarCaminata() { if (caminar != null) { navigator.geolocation.clearWatch(caminar); caminar = null; } }
    S.detenerExtra = terminarCaminata;
    mapa.on('click', function (ev) {
      if (modo !== 'area' && modo !== 'tramo') return;
      verts.push([ev.latlng.lng, ev.latlng.lat]); pintarTemp(); herramientas();
    });
    pintarFicha(); herramientas();
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
    if (!v['Cantón']) b.push([1, 'Falta el cantón']);
    if (!v['Parroquia']) b.push([1, 'Falta la parroquia']);
    if (!v['Estado del Evento']) b.push([2, 'Falta el estado del evento']);
    CIFRAS_OBLIGATORIAS.forEach(function (c) {
      if (v[c] === '' || v[c] == null) b.push([c.indexOf('Vivienda') === 0 ? 3 : 3, 'Falta: ' + ETIQUETAS[c] + ' (use "Ninguno" si es cero)']);
    });
    if (bajasSinJustificar().length && !v['Justificación de Baja']) b.push([3, 'Falta justificar la baja de una cifra de afectación']);
    if (f.tipo === 'CORRECCION' && !Object.keys(diferencias()).length && !geometriaCambio()) b.push([1, 'No hay cambios que corregir']);
    return b;
  }
  function pintarResumen() {
    var f = S.ficha, v = f.valores;
    var bl = bloqueos();
    $('#bloqueos').innerHTML = bl.map(function (x) { return '<div class="aviso error" data-paso="' + x[0] + '" style="cursor:pointer">' + esc(x[1]) + ' ›</div>'; }).join('') +
      advertencias().map(function (a) { return '<div class="aviso alerta" data-paso="3" style="cursor:pointer">' + esc(a) + '</div>'; }).join('');
    function fila(et, val, paso) { return '<tr class="ir" data-paso="' + paso + '"><td>' + esc(et) + '</td><td><b>' + (val === '' || val == null ? '<span class="muted">Sin dato</span>' : esc(val)) + '</b></td></tr>'; }
    var pi = suma(v['Personas Afectadas Directamente'], v['Personas Damnificadas']);
    var fi = suma(v['Familias Afectadas'], v['Familias Damnificadas']);
    DB.porIndice('fotos', 'id_visita', f.id_visita).then(function (fotos) {
      $('#resumen').innerHTML =
        fila('Sitio', (v['Sector'] || '') + (v['Parroquia'] ? ' · ' + v['Parroquia'] : ''), 1) +
        fila('Estado', v['Estado del Evento'] + (v['Solicitud de Cierre'] ? ' (solicita cierre)' : ''), 2) +
        fila('Familias afectadas / damnificadas', fmt(v['Familias Afectadas']) + ' / ' + fmt(v['Familias Damnificadas']), 3) +
        fila('Personas afectadas / damnificadas', fmt(v['Personas Afectadas Directamente']) + ' / ' + fmt(v['Personas Damnificadas']), 3) +
        fila('Impactadas (calculado)', 'Personas ' + fmt(pi) + ' · Familias ' + fmt(fi), 3) +
        fila('Viviendas afectadas / inhabitables', fmt(v['Viviendas Afectadas']) + ' / ' + fmt(v['Viviendas Inhabitables']), 3) +
        fila('Albergadas', fmt(v['Personas Albergadas']), 3) +
        fila('Geometría', f.geometrias.length ? f.geometrias.map(function (g) { return g.tipo; }).join(', ') : 'Solo el punto', 6) +
        (f.tipo !== 'CORRECCION' ? fila('Fotos', String(fotos.length), 7) : '');
      $$('[data-paso]').forEach(function (r) { r.onclick = function () { guardar(); vistaPaso(Number(r.getAttribute('data-paso'))); }; });
    });
    $('#enviar').disabled = bl.length > 0;
  }
  function fmt(x) { return x === '' || x == null ? 'sin dato' : String(x).replace('.', ','); }

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
    return JSON.stringify(f.geometrias.map(function (g) { return [g.tipo, g.coordenadas]; })) !== f.geometrias_base;
  }

  function enviarFicha() {
    var f = S.ficha;
    if (bloqueos().length) return pintarResumen();
    DB.porIndice('fotos', 'id_visita', f.id_visita).then(function (fotos) {
      f.fotos_declaradas = fotos.length;
      if (f.tipo === 'CORRECCION') {
        f.cambios = diferencias();
        f.fecha_observacion = ahoraISO();
        f.geometrias_envio = geometriaCambio() ? f.geometrias.map(function (g) { return { id: uuid(), tipo: g.tipo, coordenadas: g.coordenadas }; }) : [];
      } else {
        // Solo se envían las geometrías nuevas o redibujadas en esta visita
        var nuevas = f.geometrias.filter(function (g) { return !g.precargada; });
        var tipos = {}; nuevas.forEach(function (g) { tipos[g.tipo] = true; });
        // Si se redibujó o agregó algo de un tipo, se envía el conjunto completo de ese tipo
        f.geometrias_envio = f.geometrias.filter(function (g) { return tipos[g.tipo]; }).map(function (g) { return { id: g.id, tipo: g.tipo, coordenadas: g.coordenadas }; });
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
          if (a === 'abrir') abrirFicha(f, f.estado === 'error' ? 7 : f.paso);
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
  // Mapa sin conexión: descarga de teselas de las zonas pobladas
  // ----------------------------------------------------------------
  function teselasDe(caja, z) {
    function x(lon) { return Math.floor((lon + 180) / 360 * Math.pow(2, z)); }
    function y(lat) { var r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z)); }
    var out = [];
    for (var i = x(caja[0]); i <= x(caja[2]); i++) for (var j = y(caja[3]); j <= y(caja[1]); j++) out.push([z, i, j]);
    return out;
  }
  function urlsTeselas() {
    var t = [], vistos = {};
    function add(l) { l.forEach(function (k) { var id = k.join('/'); if (!vistos[id]) { vistos[id] = 1; t.push(k); } }); }
    ISLAS_MAPA.forEach(function (c) { for (var z = 9; z <= 13; z++) add(teselasDe(c, z)); });
    ZONAS_MAPA.forEach(function (zn) { for (var z = 14; z <= 17; z++) add(teselasDe(zn.caja, z)); });
    var sub = CONFIG.TESELAS_BASE_SUB;
    return t.map(function (k) {
      var s = sub[Math.abs(k[1] + k[2]) % sub.length]; // misma regla de Leaflet para elegir subdominio
      return CONFIG.TESELAS_BASE.replace('{s}', s).replace('{z}', k[0]).replace('{x}', k[1]).replace('{y}', k[2]);
    });
  }
  function vistaMapaOffline() {
    limpiarVista(); marcar('mapaoff'); titulo('Mapa sin conexión', vistaInicio);
    var urls = urlsTeselas();
    DB.kvGet('mapaOffline').then(function (info) {
      $('#vista').innerHTML = '<div class="tarjeta"><h2>Preparar el mapa</h2><p>Descarga el mapa base de las zonas pobladas de Santa Cruz, San Cristóbal, Isabela y Floreana, para dibujar afectaciones sin señal.</p>' +
        '<p class="muted">' + urls.length.toLocaleString('es') + ' teselas, unos ' + Math.round(urls.length * 18 / 1024) + ' MB. Hágalo con wifi. La imagen satelital solo carga con señal.</p>' +
        (info ? '<div class="aviso ok">Última preparación: ' + fechaLegible(new Date(info.fecha).toISOString()) + ' (' + info.ok + ' teselas)</div>' : '') +
        '<div class="barra-progreso"><div id="bp"></div></div><p id="bpTxt" class="muted"></p>' +
        '<button class="btn primario" id="desc">Descargar mapa</button></div>' +
        '<div class="tarjeta"><h2>Zonas incluidas</h2><p class="muted">' + ZONAS_MAPA.map(function (z) { return esc(z.nombre); }).join(', ') + '. Fuera de ellas el mapa se ve con menos detalle, salvo donde ya lo haya visto con señal.</p></div>';
      $('#desc').onclick = function () {
        if (!navigator.onLine) return toast('Se necesita señal');
        $('#desc').disabled = true;
        var hechas = 0, fallidas = 0, i = 0, total = urls.length;
        caches.open('campo-teselas-v1').then(function (c) {
          function sig() {
            if (i >= total) return Promise.resolve();
            var u = urls[i++];
            return c.match(u).then(function (hit) {
              if (hit) return;
              return fetch(u, { mode: 'cors' }).then(function (r) { if (r.ok) return c.put(u, r); fallidas++; }).catch(function () { fallidas++; });
            }).then(function () {
              hechas++;
              if (hechas % 10 === 0 || hechas === total) { $('#bp').style.width = (100 * hechas / total) + '%'; $('#bpTxt').textContent = hechas + ' de ' + total + (fallidas ? ' · ' + fallidas + ' fallidas' : ''); }
              return sig();
            });
          }
          return Promise.all([sig(), sig(), sig(), sig(), sig(), sig()]);
        }).then(function () {
          DB.kvSet('mapaOffline', { fecha: Date.now(), ok: total - fallidas });
          $('#desc').disabled = false;
          toast(fallidas ? 'Mapa descargado con ' + fallidas + ' teselas fallidas. Puede repetir.' : 'Mapa listo para usar sin señal');
        });
      };
    });
  }

  // ----------------------------------------------------------------
  // Arranque
  // ----------------------------------------------------------------
  function arrancar() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
    window.addEventListener('online', function () { actualizarConexion(); enviarAhora(true); });
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
