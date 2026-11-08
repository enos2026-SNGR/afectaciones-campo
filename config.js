/* Configuración de la app de campo: Registro de afectaciones, SNGR */
var CONFIG = {
  // URL /exec de la aplicación web de Apps Script (se completa al implementar el backend)
  BACKEND_URL: 'https://script.google.com/a/macros/gestionderiesgos.gob.ec/s/AKfycbzmKnGI3ki_KV5tze7B8U1QqDXeeciJi1iScAVSxdLH0xiI5fTWQVuo6nkR3l6S9ZvfvA/exec',
  VERSION: '2.4.1',
  UMBRAL_DUPLICADO_M: 100,
  PRECISION_ACEPTABLE_M: 20,
  ESPERA_GPS_S: 60,
  LISTA_VIEJA_H: 2,
  BORRADOR_RECORDATORIO_H: 1,
  RESPALDO_SUGERIDO_H: 4,
  MAX_FOTOS: 10,
  FOTO_OBJETIVO_KB: 250,
  // Mapa base propio de la SNGR (OpenStreetMap en PMTiles por provincia; ver README del repositorio mapa-base-sngr)
  MAPA_BASE_URL: 'https://enos2026-sngr.github.io/mapa-base-sngr/',
  TESELAS_SATELITE: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  TESELAS_SATELITE_ATRIB: 'Imagen © Esri'
};
