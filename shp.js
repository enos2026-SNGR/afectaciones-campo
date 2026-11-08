// ---------------- Shapefile (SHP + SHX + DBF + PRJ + CPG) en un ZIP, sin librerías ----------------
// Geometrías en WGS84 (EPSG:4326). Admite Point, LineString y Polygon (con o sin huecos).
var SHP = (function () {
  var PRJ = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
  var TIPO = { Point: 1, LineString: 3, Polygon: 5 };
  var te = new TextEncoder();

  function areaFirmada(r) { var a = 0; for (var i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return a / 2; }
  function cerrar(r) { var a = r[0], b = r[r.length - 1]; return a[0] === b[0] && a[1] === b[1] ? r : r.concat([a]); }
  // En shapefile el anillo exterior va en sentido horario y los huecos en antihorario
  function partes(g) {
    if (g.type === 'LineString') return [g.coordinates];
    if (g.type === 'Polygon') return g.coordinates.map(function (r, i) {
      r = cerrar(r); var horario = areaFirmada(r) < 0;
      return (i === 0) === horario ? r : r.slice().reverse();
    });
    return null;
  }
  function caja(pts) {
    var c = [Infinity, Infinity, -Infinity, -Infinity];
    pts.forEach(function (p) { c[0] = Math.min(c[0], p[0]); c[1] = Math.min(c[1], p[1]); c[2] = Math.max(c[2], p[0]); c[3] = Math.max(c[3], p[1]); });
    return c;
  }
  function cabecera(dv, tipo, largoBytes, c) {
    dv.setInt32(0, 9994, false); dv.setInt32(24, largoBytes / 2, false);
    dv.setInt32(28, 1000, true); dv.setInt32(32, tipo, true);
    for (var i = 0; i < 4; i++) dv.setFloat64(36 + 8 * i, isFinite(c[i]) ? c[i] : 0, true);
  }
  function shpShx(tipo, geoms) {
    var conts = geoms.map(function (g) {
      if (tipo === 1) return 20;
      var ps = partes(g), n = 0; ps.forEach(function (p) { n += p.length; });
      return 44 + 4 * ps.length + 16 * n;
    });
    var largo = 100 + conts.reduce(function (s, c) { return s + 8 + c; }, 0);
    var shp = new ArrayBuffer(largo), shx = new ArrayBuffer(100 + 8 * geoms.length);
    var d = new DataView(shp), x = new DataView(shx);
    var todos = []; geoms.forEach(function (g) { (tipo === 1 ? [[g.coordinates]] : partes(g)).forEach(function (p) { todos = todos.concat(p); }); });
    var cg = caja(todos);
    cabecera(d, tipo, largo, cg); cabecera(x, tipo, shx.byteLength, cg);
    var o = 100;
    geoms.forEach(function (g, i) {
      x.setInt32(100 + 8 * i, o / 2, false); x.setInt32(104 + 8 * i, conts[i] / 2, false);
      d.setInt32(o, i + 1, false); d.setInt32(o + 4, conts[i] / 2, false); o += 8;
      d.setInt32(o, tipo, true);
      if (tipo === 1) { d.setFloat64(o + 4, g.coordinates[0], true); d.setFloat64(o + 12, g.coordinates[1], true); o += 20; return; }
      var ps = partes(g), pts = []; ps.forEach(function (p) { pts = pts.concat(p); });
      var c = caja(pts);
      for (var k = 0; k < 4; k++) d.setFloat64(o + 4 + 8 * k, c[k], true);
      d.setInt32(o + 36, ps.length, true); d.setInt32(o + 40, pts.length, true);
      var q = o + 44, ini = 0;
      ps.forEach(function (p) { d.setInt32(q, ini, true); q += 4; ini += p.length; });
      pts.forEach(function (p) { d.setFloat64(q, p[0], true); d.setFloat64(q + 8, p[1], true); q += 16; });
      o = q;
    });
    return [new Uint8Array(shp), new Uint8Array(shx)];
  }
  // Recorta un texto a n bytes UTF-8 sin partir un carácter
  function bytesTexto(v, n) {
    var b = te.encode(v == null ? '' : String(v));
    if (b.length <= n) return b;
    var e = n; while (e > 0 && (b[e] & 0xC0) === 0x80) e--;
    return b.slice(0, e);
  }
  // campos: [{n:'NOMBRE', t:'C'|'N', k:'clave en props', d: decimales}]
  function dbf(campos, filas) {
    campos.forEach(function (c) {
      if (c.t === 'N') { c.l = 18; c.d = c.d == null ? 2 : c.d; return; }
      var m = 1; filas.forEach(function (f) { m = Math.max(m, bytesTexto(f[c.k], 254).length); }); c.l = m; c.d = 0;
    });
    var largoReg = 1 + campos.reduce(function (s, c) { return s + c.l; }, 0), largoCab = 32 + 32 * campos.length + 1;
    var buf = new Uint8Array(largoCab + largoReg * filas.length + 1), dv = new DataView(buf.buffer), h = new Date();
    buf[0] = 3; buf[1] = h.getFullYear() - 1900; buf[2] = h.getMonth() + 1; buf[3] = h.getDate();
    dv.setUint32(4, filas.length, true); dv.setUint16(8, largoCab, true); dv.setUint16(10, largoReg, true);
    campos.forEach(function (c, i) {
      var o = 32 + 32 * i; buf.set(te.encode(c.n.slice(0, 10)), o);
      buf[o + 11] = c.t.charCodeAt(0); buf[o + 16] = c.l; buf[o + 17] = c.d;
    });
    buf[largoCab - 1] = 0x0D;
    var o = largoCab;
    filas.forEach(function (f) {
      buf[o++] = 0x20;
      campos.forEach(function (c) {
        var b;
        if (c.t === 'N') {
          var v = f[c.k], num = v === '' || v == null ? NaN : Number(v);
          var s = isFinite(num) ? num.toFixed(c.d) : '';
          if (s.length > c.l) s = '';
          b = te.encode(Array(c.l - s.length + 1).join(' ') + s);
        } else {
          b = bytesTexto(f[c.k], c.l); var p = new Uint8Array(c.l).fill(0x20); p.set(b); b = p;
        }
        buf.set(b, o); o += c.l;
      });
    });
    buf[o] = 0x1A;
    return buf;
  }
  // ZIP sin compresión (método "store")
  var TCRC = (function () { var t = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = TCRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(archivos) {
    var partesZ = [], central = [], o = 0;
    archivos.forEach(function (a) {
      var nom = te.encode(a.nombre), crc = crc32(a.datos), n = a.datos.length;
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, n, true); lh.setUint32(22, n, true); lh.setUint16(26, nom.length, true);
      partesZ.push(new Uint8Array(lh.buffer), nom, a.datos);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, n, true); ch.setUint32(24, n, true); ch.setUint16(28, nom.length, true); ch.setUint32(42, o, true);
      central.push(new Uint8Array(ch.buffer), nom);
      o += 30 + nom.length + n;
    });
    var tc = central.reduce(function (s, b) { return s + b.length; }, 0);
    var fin = new DataView(new ArrayBuffer(22));
    fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true);
    fin.setUint32(12, tc, true); fin.setUint32(16, o, true);
    return new Blob(partesZ.concat(central, [new Uint8Array(fin.buffer)]), { type: 'application/zip' });
  }
  // capas: [{nombre, tipo:'Point'|'LineString'|'Polygon', campos, features:[{geometry, properties}]}]
  function generar(capas) {
    var arch = [];
    capas.forEach(function (c) {
      var fs = c.features.filter(function (f) { return f.geometry && f.geometry.type === c.tipo; });
      if (!fs.length) return;
      var ss = shpShx(TIPO[c.tipo], fs.map(function (f) { return f.geometry; }));
      arch.push({ nombre: c.nombre + '.shp', datos: ss[0] }, { nombre: c.nombre + '.shx', datos: ss[1] },
        { nombre: c.nombre + '.dbf', datos: dbf(c.campos.map(function (x) { return Object.assign({}, x); }), fs.map(function (f) { return f.properties; })) },
        { nombre: c.nombre + '.prj', datos: te.encode(PRJ) }, { nombre: c.nombre + '.cpg', datos: te.encode('UTF-8') });
    });
    return arch.length ? zip(arch) : null;
  }
  return { generar: generar };
})();
