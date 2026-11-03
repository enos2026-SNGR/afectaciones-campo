/* Sincronización con el backend. Se usa desde la página y desde el service worker (sin DOM). */
var Sync = (function () {
  var corriendo = false, actual = null;
  var canal = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel('sync-afectaciones') : null;

  function avisar(m) { try { if (canal) canal.postMessage(m); } catch (e) {} }

  function ErrorRed(msg) { this.message = msg; this.red = true; }

  function post(cuerpo, ms) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = ctrl ? setTimeout(function () { ctrl.abort(); }, ms || 45000) : null;
    return fetch(CONFIG.BACKEND_URL, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(cuerpo), signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (t) clearTimeout(t);
      return r.text().then(function (txt) {
        try { return JSON.parse(txt); } catch (e) { throw new ErrorRed('Respuesta no válida del servidor'); }
      });
    }, function (e) {
      if (t) clearTimeout(t);
      throw new ErrorRed('Sin conexión');
    });
  }

  function payloadVisita(f) {
    if (f.tipo === 'CORRECCION') {
      return { id_visita: f.id_visita, tipo: 'CORRECCION', corrige_visita: f.corrige_visita,
               fecha_observacion: f.fecha_observacion, cambios: f.cambios || {}, autor: f.autor,
               version_app: CONFIG.VERSION };
    }
    var v = {};
    Object.keys(f.valores || {}).forEach(function (k) { v[k] = f.valores[k]; });
    v.id_visita = f.id_visita;
    v.id_evento = f.id_evento;
    v.tipo = f.tipo;
    v.fecha_observacion = f.fecha_observacion;
    v['Latitud'] = f.ubicacion ? f.ubicacion.lat : '';
    v['Longitud'] = f.ubicacion ? f.ubicacion.lon : '';
    v['Precisión (m)'] = f.ubicacion && f.ubicacion.precision != null ? Math.round(f.ubicacion.precision) : '';
    v['Método Ubicación'] = f.ubicacion ? f.ubicacion.metodo : '';
    v.evento_vinculado = f.evento_vinculado || '';
    v.fotos_declaradas = f.fotos_declaradas || 0;
    v.autor = f.autor;
    v.version_app = CONFIG.VERSION;
    return v;
  }

  function base64DeBlob(blob) {
    return blob.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf), s = '', paso = 0x8000;
      for (var i = 0; i < bytes.length; i += paso) s += String.fromCharCode.apply(null, bytes.subarray(i, i + paso));
      return btoa(s);
    });
  }

  function refrescarEventos(codigo) {
    return post({ accion: 'eventos', codigo: codigo }).then(function (r) {
      if (!r.ok) throw new Error(r.error);
      return DB.kvSet('eventos', r.eventos).then(function () {
        return DB.kvSet('eventosHora', Date.now());
      }).then(function () { avisar({ tipo: 'eventos' }); return r.eventos; });
    });
  }

  function sincronizar() {
    if (!CONFIG.BACKEND_URL) return Promise.resolve({ ok: false, motivo: 'Backend no configurado' });
    // Si ya hay una sincronización en curso, se espera y se vuelve a correr para incluir lo nuevo
    if (corriendo) return actual.then(function () { return sincronizar(); });
    corriendo = true;
    avisar({ tipo: 'inicio' });
    var sesion, enviadas = 0, resumen = { ok: true, enviadas: 0, fotos: 0, errores: 0 };

    actual = DB.kvGet('sesion').then(function (s) {
      sesion = s;
      if (!sesion) throw new Error('Sin sesión');
      // 1. Primero la lista de eventos: pesa poco y evita duplicados
      return refrescarEventos(sesion.codigo);
    }).then(function () {
      return DB.todos('fichas');
    }).then(function (fichas) {
      var cola = fichas.filter(function (f) { return f.estado === 'pendiente' || f.estado === 'enviando'; })
        .sort(function (a, b) { return a.encolada < b.encolada ? -1 : 1; });
      // 2. Fichas, en el orden en que se encolaron
      return cola.reduce(function (p, f) {
        return p.then(function (seguir) {
          if (seguir === false) return false;
          f.estado = 'enviando';
          return DB.put('fichas', f).then(function () {
            avisar({ tipo: 'ficha', id: f.id_visita, estado: 'enviando' });
            return post({ accion: 'enviarVisita', codigo: sesion.codigo, visita: payloadVisita(f), geometrias: f.geometrias_envio || f.geometrias || [] });
          }).then(function (r) {
            if (r.ok) {
              f.estado = 'enviada'; f.enviada_en = new Date().toISOString();
              f.id_evento_servidor = r.id_evento; f.avisos = r.avisos || []; f.error = '';
              resumen.enviadas++;
            } else if (r.reintentar) {
              f.estado = 'pendiente'; f.error = r.error;
            } else {
              f.estado = 'error'; f.error = r.error; resumen.errores++;
            }
            return DB.put('fichas', f).then(function () { avisar({ tipo: 'ficha', id: f.id_visita, estado: f.estado }); return true; });
          }, function (e) {
            f.estado = 'pendiente';
            return DB.put('fichas', f).then(function () { if (e.red) { resumen.ok = false; resumen.motivo = e.message; return false; } return true; });
          });
        });
      }, Promise.resolve(true));
    }).then(function () {
      return Promise.all([DB.todos('fotos'), DB.todos('fichas')]);
    }).then(function (res) {
      var enviadas = {};
      res[1].forEach(function (f) { if (f.estado === 'enviada') enviadas[f.id_visita] = true; });
      var fotos = res[0].filter(function (x) { return x.estado !== 'enviada' && enviadas[x.id_visita]; });
      // 3. Fotos, una por una
      return fotos.reduce(function (p, foto) {
        return p.then(function (seguir) {
          if (seguir === false) return false;
          avisar({ tipo: 'foto', id: foto.id_foto, visita: foto.id_visita, estado: 'subiendo' });
          return base64DeBlob(foto.blob).then(function (b64) {
            return post({ accion: 'subirFoto', codigo: sesion.codigo, foto: {
              id_foto: foto.id_foto, id_visita: foto.id_visita, etiqueta: foto.etiqueta || '',
              fecha: foto.fecha, latitud: foto.lat, longitud: foto.lon, mime: foto.blob.type || 'image/jpeg', base64: b64 } }, 120000);
          }).then(function (r) {
            if (r.ok) { foto.estado = 'enviada'; foto.enlace = r.enlace; foto.error = ''; resumen.fotos++; }
            else { foto.error = r.error; if (!r.reintentar) foto.estado = 'error'; }
            return DB.put('fotos', foto).then(function () { avisar({ tipo: 'foto', id: foto.id_foto, visita: foto.id_visita, estado: foto.estado }); return true; });
          }, function (e) { if (e.red) { resumen.ok = false; resumen.motivo = e.message; return false; } return true; });
        });
      }, Promise.resolve(true));
    }).then(function () {
      if (resumen.enviadas) return refrescarEventos(sesion.codigo).catch(function () {});
    }).then(function () {
      return DB.kvSet('ultimaSync', Date.now());
    }).then(function () {
      corriendo = false; avisar({ tipo: 'fin', resumen: resumen }); return resumen;
    }, function (e) {
      corriendo = false;
      var r = { ok: false, motivo: e.message || String(e), offline: !!e.red };
      avisar({ tipo: 'fin', resumen: r }); return r;
    });
    return actual;
  }

  return { sincronizar: sincronizar, post: post, refrescarEventos: refrescarEventos, payloadVisita: payloadVisita, ErrorRed: ErrorRed };
})();
