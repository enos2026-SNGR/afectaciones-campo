/* Configuración de la app de campo */
var CONFIG = {
  // URL /exec de la aplicación web de Apps Script (se completa al implementar el backend)
  BACKEND_URL: 'https://script.google.com/a/macros/gestionderiesgos.gob.ec/s/AKfycbzmKnGI3ki_KV5tze7B8U1QqDXeeciJi1iScAVSxdLH0xiI5fTWQVuo6nkR3l6S9ZvfvA/exec',
  VERSION: '1.0.0',
  UMBRAL_DUPLICADO_M: 100,
  PRECISION_ACEPTABLE_M: 20,
  ESPERA_GPS_S: 60,
  LISTA_VIEJA_H: 2,
  BORRADOR_RECORDATORIO_H: 1,
  RESPALDO_SUGERIDO_H: 4,
  MAX_FOTOS: 10,
  FOTO_OBJETIVO_KB: 250,
  TESELAS_BASE: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
  TESELAS_BASE_SUB: ['a', 'b', 'c', 'd'],
  TESELAS_BASE_ATRIB: '© OpenStreetMap, © CARTO',
  TESELAS_SATELITE: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  TESELAS_SATELITE_ATRIB: 'Imagen © Esri'
};
