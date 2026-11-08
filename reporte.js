/* Reportes en PDF generados en el teléfono, sin conexión (jsPDF, cargado solo cuando se usa).
   - ficha(d): reporte de un evento o de una ficha, con croquis de la afectación y fotos.
   - resumen(d): reporte de varios eventos (administrador), con indicadores y tablas.
   Fuente Helvetica (admite tildes, ñ y ¿). Medidas en milímetros, A4 vertical. */
var ReportePDF = (function () {
  var AZUL = [1, 50, 84], ORO = [252, 179, 0], ROJO = [214, 40, 40], GRIS = [91, 101, 115], LINEA = [184, 192, 204];
  var M = 14, ANCHO = 210, ALTO = 297, UTIL = ANCHO - 2 * M;
  var cargando = null, logo = null;

  function cargarLib() {
    if (window.jspdf) return Promise.resolve();
    if (cargando) return cargando;
    cargando = new Promise(function (ok, mal) {
      var s = document.createElement('script'); s.src = 'vendor/jspdf/jspdf.umd.min.js';
      s.onload = function () { ok(); }; s.onerror = function () { cargando = null; mal(new Error('No se pudo cargar el generador de PDF')); };
      document.head.appendChild(s);
    });
    return cargando;
  }
  function imagenADatos(src, max, calidad) {
    return new Promise(function (ok) {
      var img = new Image();
      img.onload = function () {
        var k = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        ok({ datos: c.toDataURL('image/jpeg', calidad || 0.8), w: c.width, h: c.height });
      };
      img.onerror = function () { ok(null); };
      img.src = src;
    });
  }
  function cargarLogo() { return logo ? Promise.resolve(logo) : imagenADatos('img/logo-sngr.png', 900, 0.92).then(function (x) { logo = x; return x; }); }
  function blobADatos(blob) { var u = URL.createObjectURL(blob); return imagenADatos(u, 1100, 0.72).then(function (x) { URL.revokeObjectURL(u); return x; }); }

  // ---------- Utilidades de página ----------
  function Hoja(titulo, subtitulo) {
    var doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    var h = { doc: doc, y: M };
    h.cabecera = function () {
      if (logo) { var w = 46, alto = w * logo.h / logo.w; doc.addImage(logo.datos, 'JPEG', M, M - 2, w, alto); }
      doc.setTextColor.apply(doc, AZUL); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
      var t = doc.splitTextToSize(titulo, UTIL - 52); doc.text(t, M + 52, M + 3);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(40, 40, 40);
      doc.text(doc.splitTextToSize(subtitulo, UTIL - 52), M + 52, M + 3 + t.length * 5.5);
      h.y = M + 18;
      doc.setDrawColor.apply(doc, ORO); doc.setLineWidth(0.9); doc.line(M, h.y, ANCHO - M, h.y);
      h.y += 6;
    };
    h.espacio = function (n) { if (h.y + n > ALTO - 16) { doc.addPage(); h.y = M; return true; } return false; };
    h.seccion = function (t) {
      h.y += 4;
      h.espacio(14);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor.apply(doc, AZUL); doc.text(t, M, h.y);
      h.y += 2; doc.setDrawColor.apply(doc, AZUL); doc.setLineWidth(0.3); doc.line(M, h.y, ANCHO - M, h.y); h.y += 5;
    };
    h.parrafo = function (t, tam, color) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(tam || 9.5); doc.setTextColor.apply(doc, color || [30, 30, 30]);
      doc.splitTextToSize(String(t), UTIL).forEach(function (l) { h.espacio(5); doc.text(l, M, h.y); h.y += (tam || 9.5) * 0.45; });
      h.y += 1.5;
    };
    // Tabla con encabezado azul que se repite al cambiar de página
    h.tabla = function (cols, filas, opc) {
      opc = opc || {};
      var tam = opc.tam || 8.5, lh = tam * 0.42, pad = 1.6;
      var total = cols.reduce(function (s, c) { return s + c.w; }, 0), k = UTIL / total;
      var anchos = cols.map(function (c) { return c.w * k; });
      function fila(celdas, cab) {
        doc.setFont('helvetica', cab ? 'bold' : 'normal'); doc.setFontSize(tam);
        var lineas = celdas.map(function (c, i) { return doc.splitTextToSize(c == null || c === '' ? (cab ? '' : '-') : String(c), anchos[i] - 2 * pad); });
        var alto = Math.max.apply(null, lineas.map(function (l) { return l.length; })) * lh + 2 * pad + 0.8;
        if (h.espacio(alto) && !cab && cols.some(function (c) { return c.t; })) fila(cols.map(function (c) { return c.t; }), true);
        var x = M;
        lineas.forEach(function (l, i) {
          if (cab) { doc.setFillColor.apply(doc, AZUL); doc.rect(x, h.y, anchos[i], alto, 'F'); doc.setTextColor(255, 255, 255); }
          else { doc.setTextColor(30, 30, 30); if (opc.clave && i === 0) { doc.setFillColor(244, 246, 249); doc.rect(x, h.y, anchos[i], alto, 'F'); doc.setFont('helvetica', 'bold'); } else doc.setFont('helvetica', 'normal'); }
          doc.setDrawColor.apply(doc, LINEA); doc.setLineWidth(0.2); doc.rect(x, h.y, anchos[i], alto);
          doc.text(l, x + pad, h.y + pad + lh * 0.85);
          x += anchos[i];
        });
        h.y += alto;
      }
      if (cols.some(function (c) { return c.t; })) fila(cols.map(function (c) { return c.t; }), true);
      filas.forEach(function (f) { fila(f, false); });
      h.y += 4;
    };
    h.pie = function (texto) {
      var n = doc.internal.getNumberOfPages();
      for (var i = 1; i <= n; i++) {
        doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor.apply(doc, GRIS);
        doc.setDrawColor.apply(doc, LINEA); doc.setLineWidth(0.2); doc.line(M, ALTO - 11, ANCHO - M, ALTO - 11);
        doc.text(texto, M, ALTO - 7); doc.text('Página ' + i + ' de ' + n, ANCHO - M, ALTO - 7, { align: 'right' });
      }
    };
    return h;
  }
  function ahoraTexto() { var d = new Date(Date.now() - 5 * 3600e3).toISOString(); return d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) + ' ' + d.slice(11, 16); }

  // ---------- Croquis: dibujo a escala del sitio y de la afectación, sin mapa de fondo ----------
  function croquis(h, d) {
    var doc = h.doc, W = UTIL, H = 92;
    h.espacio(H + 16);
    // Con mapa de fondo: la imagen ya trae el mapa base, el sitio, la afectación, la escala y el norte
    if (d.mapa) {
      var alto = W * d.mapa.h / d.mapa.w;
      doc.addImage(d.mapa.datos, 'JPEG', M, h.y, W, alto);
      doc.setDrawColor.apply(doc, LINEA); doc.setLineWidth(0.3); doc.rect(M, h.y, W, alto);
      h.y += alto + 4;
      leyenda(h);
      h.parrafo('Mapa base de la SNGR elaborado con datos de OpenStreetMap (© colaboradores de OpenStreetMap). Coordenadas WGS84.', 7.5, GRIS);
      return;
    }
    var lat0 = d.lat, lon0 = d.lon, cosl = Math.cos(lat0 * Math.PI / 180);
    var xy = function (c) { return [(c[0] - lon0) * cosl * 111320, (c[1] - lat0) * 110540]; };
    var todos = [[0, 0]];
    d.geoms.forEach(function (g) { coords(g.geojson).forEach(function (c) { todos.push(xy(c)); }); });
    var x0 = Math.min.apply(null, todos.map(function (p) { return p[0]; })), x1 = Math.max.apply(null, todos.map(function (p) { return p[0]; }));
    var y0 = Math.min.apply(null, todos.map(function (p) { return p[1]; })), y1 = Math.max.apply(null, todos.map(function (p) { return p[1]; }));
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, ex = Math.max(x1 - x0, 80) * 1.25, ey = Math.max(y1 - y0, 80) * 1.25;
    var esc = Math.min(W / ex, H / ey); // mm por metro
    var bx = M, by = h.y;
    var P = function (c) { var p = xy(c); return [bx + W / 2 + (p[0] - cx) * esc, by + H / 2 - (p[1] - cy) * esc]; };
    doc.setFillColor(250, 251, 252); doc.setDrawColor.apply(doc, LINEA); doc.setLineWidth(0.3); doc.rect(bx, by, W, H, 'FD');
    function trazo(pts, cerrar, estilo) {
      if (pts.length < 2) return;
      var d0 = pts[0], rel = [];
      for (var i = 1; i < pts.length; i++) rel.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]);
      doc.lines(rel, d0[0], d0[1], [1, 1], estilo, cerrar);
    }
    d.geoms.forEach(function (g) {
      var t = g.tipo, gj = g.geojson;
      doc.setLineDashPattern([], 0);
      if (gj.type === 'Polygon') {
        doc.setFillColor(198, 217, 236); doc.setDrawColor.apply(doc, AZUL); doc.setLineWidth(0.6);
        trazo(gj.coordinates[0].map(P), true, 'FD');
      } else if (gj.type === 'LineString') {
        doc.setDrawColor.apply(doc, t === 'Cauce desbordado' ? [31, 119, 180] : AZUL); doc.setLineWidth(1.1);
        if (t === 'Cauce desbordado') doc.setLineDashPattern([2.5, 1.5], 0);
        if (t === 'Otra línea') doc.setLineDashPattern([0.8, 1], 0);
        trazo(gj.coordinates.map(P), false, 'S');
        doc.setLineDashPattern([], 0);
      } else if (gj.type === 'Point') {
        var p = P(gj.coordinates); doc.setFillColor.apply(doc, AZUL);
        doc.triangle(p[0] - 1.8, p[1], p[0], p[1] - 1.8, p[0] + 1.8, p[1], 'F'); doc.triangle(p[0] - 1.8, p[1], p[0], p[1] + 1.8, p[0] + 1.8, p[1], 'F');
      }
    });
    // Sitio del evento
    var s = P([lon0, lat0]);
    doc.setFillColor.apply(doc, ROJO); doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.6); doc.circle(s[0], s[1], 2.2, 'FD');
    doc.setFillColor(255, 255, 255); doc.circle(s[0], s[1], 0.8, 'F');
    // Norte y escala
    doc.setTextColor.apply(doc, AZUL); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.setFillColor.apply(doc, AZUL); doc.triangle(bx + W - 8, by + 4, bx + W - 10, by + 10, bx + W - 6, by + 10, 'F'); doc.text('N', bx + W - 8, by + 14, { align: 'center' });
    var opciones = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000], largo = opciones[0];
    opciones.forEach(function (o) { if (o * esc <= W / 4) largo = o; });
    var lx = bx + 6, ly = by + H - 6;
    doc.setDrawColor(30, 30, 30); doc.setLineWidth(0.6); doc.line(lx, ly, lx + largo * esc, ly); doc.line(lx, ly - 1.5, lx, ly + 0.5); doc.line(lx + largo * esc, ly - 1.5, lx + largo * esc, ly + 0.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(30, 30, 30);
    doc.text(largo >= 1000 ? (largo / 1000) + ' km' : largo + ' m', lx + largo * esc / 2, ly - 2, { align: 'center' });
    h.y = by + H + 4;
    leyenda(h);
    h.parrafo('Croquis a escala dibujado con las coordenadas registradas (WGS84). No incluye mapa de fondo porque el mapa de esta zona no está descargado en el teléfono y no había señal; para ubicarlo sobre cartografía use las capas SHP.', 7.5, GRIS);
  }
  function leyenda(h) {
    var doc = h.doc;
    doc.setFontSize(8); var x = M;
    var item = function (dib, txt) { dib(x, h.y); doc.setTextColor(30, 30, 30); doc.text(txt, x + 7, h.y + 1); x += 9 + doc.getTextWidth(txt); };
    item(function (a, b) { doc.setFillColor.apply(doc, ROJO); doc.circle(a + 2, b, 1.6, 'F'); }, 'Sitio del evento');
    item(function (a, b) { doc.setFillColor(198, 217, 236); doc.setDrawColor.apply(doc, AZUL); doc.setLineWidth(0.5); doc.rect(a, b - 1.5, 5, 3, 'FD'); }, 'Área afectada');
    item(function (a, b) { doc.setDrawColor.apply(doc, AZUL); doc.setLineWidth(1); doc.line(a, b, a + 5, b); }, 'Vía afectada');
    item(function (a, b) { doc.setDrawColor(31, 119, 180); doc.setLineWidth(1); doc.setLineDashPattern([1.5, 1], 0); doc.line(a, b, a + 5, b); doc.setLineDashPattern([], 0); }, 'Cauce desbordado');
    item(function (a, b) { doc.setFillColor.apply(doc, AZUL); doc.triangle(a + 1, b, a + 2.5, b - 1.5, a + 4, b, 'F'); doc.triangle(a + 1, b, a + 2.5, b + 1.5, a + 4, b, 'F'); }, 'Punto crítico');
    h.y += 5;
  }
  function coords(gj) { return gj.type === 'Polygon' ? gj.coordinates[0] : gj.type === 'LineString' ? gj.coordinates : [gj.coordinates]; }

  // ---------- Reporte de un evento o ficha ----------
  function ficha(d) {
    return cargarLib().then(cargarLogo).then(function () {
      return Promise.all((d.fotos || []).slice(0, 8).map(function (f) { return blobADatos(f.blob).then(function (x) { return x && Object.assign(x, { etiqueta: f.etiqueta }); }); }));
    }).then(function (fotos) {
      var h = Hoja('Ficha de afectación en territorio', d.tipo_evento + ' · ' + d.id_evento + ' · ' + d.tipo_ficha + '\nGenerado el ' + ahoraTexto() + ' · Registro de afectaciones, SNGR' + (d.aviso ? '\n' + d.aviso : ''));
      h.cabecera();
      h.seccion('Ubicación');
      h.tabla([{ w: 34 }, { w: 66 }], [
        ['Provincia, cantón y parroquia', [d.provincia, d.canton, d.parroquia].filter(Boolean).join(', ') + (d.cod ? ' (código ' + d.cod + ')' : '')],
        ['Sector o barrio', d.sector], ['Coordenadas (WGS84)', d.lat.toFixed(6) + ', ' + d.lon.toFixed(6) + (d.metodo ? ' · ' + (d.metodo === 'GPS' ? 'GPS' + (d.precision ? ' ' + Math.round(d.precision) + ' m' : '') : 'marcado en el mapa') : '')],
        ['Fecha de observación', d.fecha], ['Técnico', d.tecnico]
      ], { clave: true });
      h.seccion('Mapa de la afectación');
      croquis(h, d);
      h.seccion('Evento');
      var ev = [['Tipo de evento', d.tipo_evento], ['Estado del evento', d.v['Estado del Evento']]];
      if (d.tipo_evento === 'Inundación') ev.push(['Origen', d.v['Origen']]);
      if (d.tipo_evento !== 'Movimiento en masa') ev.push(['Nivel del agua', d.v['Nivel del Agua']], ['Tendencia del agua', d.v['Tendencia del Agua']]);
      ev.push(['Descripción del evento', d.v['Descripción']]);
      h.tabla([{ w: 34 }, { w: 66 }], ev, { clave: true });
      h.seccion('Personas y viviendas');
      h.tabla([{ w: 34 }, { w: 66 }], [['¿Hay personas afectadas?', d.hayP], ['¿Hay viviendas afectadas?', d.hayV], ['Descripción de la afectación', d.v['Descripción de la Afectación']]], { clave: true });
      h.seccion('Servicios e infraestructura');
      var inf = d.v['Hay Infraestructura Esencial Afectada'] || '';
      if (inf === 'Sí') inf += ': ' + (d.v['Infraestructura Esencial Afectada'] || []).join(', ') + (d.v['Otra Infraestructura Afectada'] ? ' (' + d.v['Otra Infraestructura Afectada'] + ')' : '');
      h.tabla([{ w: 34 }, { w: 66 }], [['Agua potable', d.v['Agua Potable']], ['Alcantarillado o pozos sépticos', d.v['Alcantarillado o Pozos Sépticos']], ['Energía eléctrica', d.v['Energía Eléctrica']],
        ['Telefonía e internet', d.v['Telefonía e Internet']], ['Vía de acceso al sitio', d.v['Vía de Acceso']], ['Infraestructura esencial afectada', inf]], { clave: true });
      h.seccion('Necesidades inmediatas');
      h.parrafo((d.v['Necesidades Inmediatas'] || []).join(', ') || 'Sin dato');
      h.seccion('Elementos dibujados');
      if (d.geoms.length) h.tabla([{ t: 'Elemento', w: 30 }, { t: 'Detalle', w: 26 }, { t: 'Medida', w: 22 }, { t: 'Nota', w: 40 }], d.geoms.map(function (g) { return [g.nombre, g.detalle, g.medida, g.nota]; }));
      else h.parrafo('Solo el punto del sitio.');
      fotos = fotos.filter(Boolean);
      if (fotos.length) {
        h.seccion('Fotos (' + fotos.length + ')');
        var col = 0, ancho = (UTIL - 6) / 2, filaAlto = 0;
        fotos.forEach(function (f) {
          var alto = Math.min(70, ancho * f.h / f.w), w = alto * f.w / f.h;
          if (col === 0 && h.espacio(alto + 8)) filaAlto = 0;
          var x = M + col * (ancho + 6);
          h.doc.addImage(f.datos, 'JPEG', x, h.y, w, alto);
          h.doc.setFontSize(7.5); h.doc.setTextColor.apply(h.doc, GRIS); h.doc.text(f.etiqueta || 'Foto', x, h.y + alto + 3.5);
          filaAlto = Math.max(filaAlto, alto + 7);
          if (col === 1) { h.y += filaAlto; filaAlto = 0; }
          col = 1 - col;
        });
        if (col === 1) h.y += filaAlto;
      }
      h.pie('Registro de afectaciones, SNGR · ' + d.id_evento + ' · Información levantada en territorio, sujeta a verificación');
      return h.doc.output('blob');
    });
  }

  // ---------- Reporte de varios eventos (administrador) ----------
  function resumen(d) {
    return cargarLib().then(cargarLogo).then(function () {
      var h = Hoja('Reporte de afectaciones registradas en territorio', 'Corte: ' + ahoraTexto() + ' · Registro de afectaciones, SNGR\nAlcance: ' + d.alcance);
      h.cabecera();
      h.seccion('Indicadores');
      h.tabla([{ t: 'Indicador', w: 55 }, { t: 'Valor', w: 15 }, { t: 'Detalle', w: 40 }], d.indicadores.map(function (k) { return [k[0], String(k[1]), k[2]]; }));
      h.parrafo('Los indicadores cuentan eventos, no personas ni viviendas: la ficha registra si hay afectación (Sí, No o No se pudo verificar). Los posibles duplicados no se cuentan hasta que el administrador los resuelva. Activo: el fenómeno continúa. Sin evolución: el fenómeno se detuvo, aunque persistan consecuencias.', 7.5, GRIS);
      h.seccion('Eventos por provincia, cantón y parroquia');
      h.tabla([{ t: 'Provincia', w: 16 }, { t: 'Cantón', w: 16 }, { t: 'Parroquia', w: 18 }, { t: 'Eventos', w: 9 }, { t: 'Activos', w: 9 }, { t: 'Con personas afectadas', w: 11 }, { t: 'Con viviendas afectadas', w: 11 }, { t: 'Con infraestructura esencial', w: 12 }, { t: 'Área afectada (ha)', w: 10 }], d.territorio, { tam: 7.5 });
      h.seccion('Detalle de eventos');
      h.tabla([{ t: 'Evento', w: 20 }, { t: 'Ubicación', w: 28 }, { t: 'Estado', w: 13 }, { t: 'Afectación', w: 24 }, { t: 'Descripción', w: 30 }], d.detalle, { tam: 7.5 });
      h.pie('Registro de afectaciones, SNGR · Información levantada en territorio, sujeta a verificación');
      return h.doc.output('blob');
    });
  }
  return { ficha: ficha, resumen: resumen, cargar: cargarLib };
})();
