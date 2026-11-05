/* Mapa base propio de la SNGR (datos de OpenStreetMap en formato PMTiles, alojados en GitHub Pages).
   - En línea: las teselas se leen por rangos del archivo de cada provincia (z 10 a 15) o del archivo nacional (z 0 a 9).
   - Sin conexión: se usan las teselas descargadas por cantón o por provincia, guardadas en IndexedDB.
   El índice (indice.json) dice qué versión del mapa está vigente y la caja de cada provincia. */
var MapaBase = (function () {
  var IND = null, archivos = {};
  var ZMAX = 15, ZNAC = 9;

  function base() { return CONFIG.MAPA_BASE_URL; }
  function indice() {
    if (IND) return Promise.resolve(IND);
    return DB.kvGet('mapaIndice').then(function (guardado) {
      if (!navigator.onLine && guardado) { IND = guardado; return IND; }
      return fetch(base() + 'indice.json', { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error('indice ' + r.status);
        return r.json();
      }).then(function (j) { IND = j; DB.kvSet('mapaIndice', j); return j; })
        .catch(function (e) { if (guardado) { IND = guardado; return IND; } throw e; });
    });
  }
  function lon2x(lon, z) { return Math.floor((lon + 180) / 360 * Math.pow(2, z)); }
  function lat2y(lat, z) { var r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z)); }
  function x2lon(x, z) { return x / Math.pow(2, z) * 360 - 180; }
  function y2lat(y, z) { var n = Math.PI - 2 * Math.PI * y / Math.pow(2, z); return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); }
  function cajaTesela(z, x, y) { return [x2lon(x, z), y2lat(y + 1, z), x2lon(x + 1, z), y2lat(y, z)]; }
  function dentro(c, lon, lat) { return lon >= c[0] && lon <= c[2] && lat >= c[1] && lat <= c[3]; }
  // Archivo que contiene la tesela: el nacional en zooms bajos; en los altos, la provincia cuya caja contiene su centro
  function archivoDe(z, x, y) {
    if (z <= ZNAC) return 'pais';
    var c = cajaTesela(z, x, y), lon = (c[0] + c[2]) / 2, lat = (c[1] + c[3]) / 2;
    var ks = Object.keys(IND.provincias);
    for (var i = 0; i < ks.length; i++) if (dentro(IND.provincias[ks[i]].caja, lon, lat)) return ks[i];
    return null;
  }
  function pm(cod) {
    if (!archivos[cod]) archivos[cod] = new pmtiles.PMTiles(base() + IND.version + '/' + cod + '.pmtiles');
    return archivos[cod];
  }
  function clave(z, x, y) { return IND.version + '/' + z + '/' + x + '/' + y; }

  // Lo descargado con una versión anterior del mapa se sigue usando hasta que se vuelva a descargar
  var versionesLocales = null;
  function buscarLocal(z, x, y) {
    var p = versionesLocales ? Promise.resolve(versionesLocales) : DB.kvGet('mapasDescargados').then(function (l) {
      versionesLocales = [IND.version].concat((l || []).map(function (a) { return a.version; }).filter(function (v) { return v && v !== IND.version; }));
      return versionesLocales;
    });
    return p.then(function (vs) {
      var i = 0;
      function sig() {
        if (i >= vs.length) return undefined;
        return DB.get('teselas', vs[i++] + '/' + z + '/' + x + '/' + y).then(function (t) { return t || sig(); });
      }
      return sig();
    });
  }

  // Fuente para protomaps-leaflet: primero lo descargado, luego la red
  var fuente = {
    getZxy: function (z, x, y, signal) {
      return indice().then(function () { return buscarLocal(z, x, y); }).then(function (t) {
        if (t) return t.data ? { data: t.data } : undefined;
        if (!navigator.onLine) return undefined;
        var cod = archivoDe(z, x, y);
        if (!cod) return undefined;
        return pm(cod).getZxy(z, x, y, signal).then(function (r) { return r ? { data: r.data } : undefined; });
      }).catch(function () { return undefined; });
    }
  };

  function capa() {
    return protomapsL.leafletLayer({ url: fuente, flavor: 'light', lang: 'es', maxDataZoom: ZMAX,
      attribution: 'Mapa base SNGR · datos © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' });
  }

  // ---------------- Descarga por cantón o provincia ----------------
  function anillos(geom) { return geom.type === 'Polygon' ? [geom.coordinates[0]] : geom.coordinates.map(function (p) { return p[0]; }); }
  function puntoEn(lon, lat, anillo) {
    var d = false;
    for (var i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
      var xi = anillo[i][0], yi = anillo[i][1], xj = anillo[j][0], yj = anillo[j][1];
      if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) d = !d;
    }
    return d;
  }
  // Teselas que cubren un conjunto de polígonos: centro dentro o algún vértice dentro, más un anillo de vecinas
  function teselasDeArea(geoms, zmin, zmax) {
    var res = [], vistos = {};
    var rs = []; geoms.forEach(function (g) { rs = rs.concat(anillos(g)); });
    var caja = [180, 90, -180, -90];
    rs.forEach(function (r) { r.forEach(function (p) { caja[0] = Math.min(caja[0], p[0]); caja[1] = Math.min(caja[1], p[1]); caja[2] = Math.max(caja[2], p[0]); caja[3] = Math.max(caja[3], p[1]); }); });
    var previo = null;
    for (var z = zmin; z <= zmax; z++) {
      var x0 = lon2x(caja[0], z), x1 = lon2x(caja[2], z), y0 = lat2y(caja[3], z), y1 = lat2y(caja[1], z);
      var marca = {};
      if (z <= 11) { for (var a = x0; a <= x1; a++) for (var b = y0; b <= y1; b++) marca[a + '/' + b] = 1; }
      else if (z > 13 && previo) {
        // Sobre el nivel 13 basta tomar las hijas de las teselas ya elegidas: evita millones de pruebas en provincias grandes
        Object.keys(previo).forEach(function (k) {
          var q = k.split('/').map(Number);
          for (var dx = 0; dx < 2; dx++) for (var dy = 0; dy < 2; dy++) marca[(2 * q[0] + dx) + '/' + (2 * q[1] + dy)] = 1;
        });
      } else {
        for (var i = x0; i <= x1; i++) for (var j = y0; j <= y1; j++) {
          var c = cajaTesela(z, i, j), lon = (c[0] + c[2]) / 2, lat = (c[1] + c[3]) / 2;
          if (rs.some(function (r) { return puntoEn(lon, lat, r); })) marca[i + '/' + j] = 1;
        }
        rs.forEach(function (r) { r.forEach(function (p) { marca[lon2x(p[0], z) + '/' + lat2y(p[1], z)] = 1; }); });
        Object.keys(marca).forEach(function (k) {
          var q = k.split('/').map(Number);
          for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) marca[(q[0] + dx) + '/' + (q[1] + dy)] = 1;
        });
      }
      previo = marca;
      Object.keys(marca).forEach(function (k) {
        var q = k.split('/').map(Number), id = z + '/' + k;
        if (!vistos[id]) { vistos[id] = 1; res.push([z, q[0], q[1]]); }
      });
    }
    return res;
  }
  // Estimación: peso del archivo de la provincia, en proporción a las teselas del área (nivel 15) y descomprimido (x2)
  function estimar(lista, prov) {
    var p = IND.provincias[prov];
    if (!p) return Math.max(1, Math.round(lista.length * 3 / 1024));
    var c = p.caja, z = ZMAX;
    var enCaja = (lon2x(c[2], z) - lon2x(c[0], z) + 1) * (lat2y(c[1], z) - lat2y(c[3], z) + 1);
    var en15 = lista.filter(function (t) { return t[0] === z; }).length;
    return Math.max(1, Math.round(p.mb * 2 * Math.min(1, en15 / enCaja)));
  }
  function planificar(area) {
    return indice().then(function () {
      var lista = teselasDeArea(area.geoms, 6, ZMAX);
      return { area: area, teselas: lista, mb: estimar(lista, area.prov) };
    });
  }
  // Descarga con 6 solicitudes en paralelo; reanudable (salta lo que ya está) y cancelable
  function descargar(plan, avance, cancelado) {
    var id = plan.area.id, lista = plan.teselas, i = 0, hechas = 0, fallidas = 0, bytes = 0;
    function una() {
      if (cancelado && cancelado()) return Promise.resolve();
      if (i >= lista.length) return Promise.resolve();
      var t = lista[i++], k = clave(t[0], t[1], t[2]);
      return DB.get('teselas', k).then(function (ya) {
        if (ya) {
          if (ya.areas.indexOf(id) < 0) { ya.areas.push(id); return DB.put('teselas', ya); }
          return;
        }
        var cod = archivoDe(t[0], t[1], t[2]);
        if (!cod) return;
        return pm(cod).getZxy(t[0], t[1], t[2]).then(function (r) {
          var data = r ? r.data : null;
          if (data) bytes += data.byteLength;
          return DB.put('teselas', { k: k, data: data, areas: [id] });
        }).catch(function () { fallidas++; });
      }).then(function () {
        hechas++;
        if (avance && (hechas % 20 === 0 || hechas === lista.length)) avance(hechas, lista.length, fallidas);
        return una();
      });
    }
    return Promise.all([una(), una(), una(), una(), una(), una()]).then(function () {
      if (cancelado && cancelado()) return { cancelado: true, hechas: hechas };
      return DB.kvGet('mapasDescargados').then(function (l) {
        l = (l || []).filter(function (a) { return a.id !== id; });
        l.push({ id: id, nombre: plan.area.nombre, tipo: plan.area.tipo, fecha: Date.now(), teselas: lista.length - fallidas, mb: Math.round(bytes / 1048576), version: IND.version, fallidas: fallidas });
        versionesLocales = null;
        return DB.kvSet('mapasDescargados', l);
      }).then(function () { return { hechas: hechas, fallidas: fallidas, mb: Math.round(bytes / 1048576) }; });
    });
  }
  // Borra un área: las teselas compartidas con otra área descargada se conservan
  function borrar(id) {
    return DB.porIndice('teselas', 'areas', id).then(function (ts) {
      return DB.tx('teselas', 'readwrite', function (s) {
        ts.forEach(function (t) {
          t.areas = t.areas.filter(function (a) { return a !== id; });
          if (t.areas.length) s.put(t); else s.delete(t.k);
        });
      });
    }).then(function () { return DB.kvGet('mapasDescargados'); })
      .then(function (l) { versionesLocales = null; return DB.kvSet('mapasDescargados', (l || []).filter(function (a) { return a.id !== id; })); });
  }
  function descargados() { return DB.kvGet('mapasDescargados').then(function (l) { return l || []; }); }

  return { capa: capa, indice: indice, planificar: planificar, descargar: descargar, borrar: borrar, descargados: descargados,
           teselasDeArea: teselasDeArea, fuente: fuente };
})();
