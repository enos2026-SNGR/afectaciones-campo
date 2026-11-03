/* Almacenamiento local en IndexedDB. Se usa desde la página y desde el service worker. */
var DB = (function () {
  var NOMBRE = 'afectaciones-galapagos', VERSION = 1, _db = null;

  function abrir() {
    if (_db) return Promise.resolve(_db);
    return new Promise(function (ok, mal) {
      var r = indexedDB.open(NOMBRE, VERSION);
      r.onupgradeneeded = function () {
        var db = r.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('fichas')) {
          var f = db.createObjectStore('fichas', { keyPath: 'id_visita' });
          f.createIndex('estado', 'estado');
        }
        if (!db.objectStoreNames.contains('fotos')) {
          var p = db.createObjectStore('fotos', { keyPath: 'id_foto' });
          p.createIndex('id_visita', 'id_visita');
        }
      };
      r.onsuccess = function () { _db = r.result; _db.onversionchange = function () { _db.close(); _db = null; }; ok(_db); };
      r.onerror = function () { mal(r.error); };
    });
  }

  function tx(store, modo, fn) {
    return abrir().then(function (db) {
      return new Promise(function (ok, mal) {
        var t = db.transaction(store, modo), s = t.objectStore(store), res;
        var r = fn(s);
        if (r && 'onsuccess' in r) r.onsuccess = function () { res = r.result; };
        t.oncomplete = function () { ok(res); };
        t.onerror = function () { mal(t.error); };
        t.onabort = function () { mal(t.error); };
      });
    });
  }

  return {
    get: function (store, k) { return tx(store, 'readonly', function (s) { return s.get(k); }); },
    put: function (store, v, k) { return tx(store, 'readwrite', function (s) { return k === undefined ? s.put(v) : s.put(v, k); }); },
    del: function (store, k) { return tx(store, 'readwrite', function (s) { return s.delete(k); }); },
    todos: function (store) { return tx(store, 'readonly', function (s) { return s.getAll(); }); },
    porIndice: function (store, indice, valor) {
      return tx(store, 'readonly', function (s) { return s.index(indice).getAll(valor); });
    },
    kvGet: function (k) { return tx('kv', 'readonly', function (s) { return s.get(k); }); },
    kvSet: function (k, v) { return tx('kv', 'readwrite', function (s) { return s.put(v, k); }); }
  };
})();
