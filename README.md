# Registro de afectaciones en territorio, inundaciones Galápagos

App web instalable (PWA) para levantar afectaciones desde el celular, con y sin conexión.
Envía las fichas al backend de Google Apps Script, que escribe en el Google Sheet
REGISTRO_AFECTACIONES_GALAPAGOS y alimenta el visor de afectaciones.

- `config.js`: URL del backend (`BACKEND_URL`) y umbrales.
- `catalogos.js`: listas cerradas; deben coincidir con `CATALOGOS` del backend.
- `datos/parroquias.geojson`: límites parroquiales de Galápagos (propiedades `canton`, `parroquia`), opcional.
- `sw.js`: abre la app sin señal, guarda teselas del mapa y sincroniza en segundo plano en Android.
