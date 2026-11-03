/* Listas cerradas y definiciones. Deben coincidir con CATALOGOS en el backend (Code.gs). */
var CATALOGOS = {
  parroquias: {
    'SAN CRISTÓBAL': ['PUERTO BAQUERIZO MORENO', 'EL PROGRESO', 'ISLA SANTA MARÍA FLOREANA'],
    'SANTA CRUZ': ['PUERTO AYORA', 'BELLA VISTA', 'SANTA ROSA'],
    'ISABELA': ['PUERTO VILLAMIL', 'TOMÁS DE BERLANGA']
  },
  'Origen': ['Lluvia intensa', 'Oleaje o aguaje', 'Lluvia y oleaje combinados', 'No determinado'],
  'Nivel del Agua': ['Sin agua', 'Hasta el tobillo (menos de 0,30 m)', 'Hasta la rodilla (0,30 a 0,50 m)',
                     'Hasta la cintura (0,50 a 1 m)', 'Sobre la cintura (más de 1 m)'],
  'Tendencia del Agua': ['Subiendo', 'Estable', 'Bajando', 'Sin agua'],
  'Estado del Evento': ['En curso', 'En atención', 'Estabilizado'],
  'Solicitud de Cierre': ['Familias retornaron y servicios restablecidos', 'Afectación atendida',
                          'Sin afectación verificada'],
  'Servicio': ['Sin afectación', 'Afectación parcial', 'Sin servicio', 'Sin dato'],
  'Vía de Acceso': ['Habilitada', 'Paso restringido', 'Cerrada', 'Sin dato'],
  'Funcionamiento': ['Funciona', 'Funciona parcialmente', 'No funciona'],
  'Justificación de Baja': ['Conteo depurado', 'Error de registro anterior', 'Reubicación'],
  'Grupos Prioritarios': ['Adultos mayores', 'Niñas y niños', 'Personas con discapacidad', 'Mujeres embarazadas'],
  'Necesidades Inmediatas': ['Agua para consumo', 'Alimentos', 'Kits de higiene', 'Kits de limpieza',
                             'Alojamiento temporal', 'Colchones y cobijas', 'Bombas de achique',
                             'Maquinaria', 'Atención de salud', 'Ninguna'],
  'Etiqueta Foto': ['Vista general', 'Viviendas', 'Vía', 'Servicios', 'Albergue'],
  'Tipo Geometría': ['Área inundada', 'Tramo de vía']
};

var CIFRAS_OBLIGATORIAS = [
  'Familias Afectadas', 'Personas Afectadas Directamente',
  'Familias Damnificadas', 'Personas Damnificadas',
  'Viviendas Afectadas', 'Viviendas Inhabitables'
];

// Etiquetas cortas para la pantalla (la clave es el nombre de columna del Sheet)
var ETIQUETAS = {
  'Personas Afectadas Directamente': 'Personas afectadas',
  'Familias Afectadas': 'Familias afectadas',
  'Familias Damnificadas': 'Familias damnificadas',
  'Personas Damnificadas': 'Personas damnificadas',
  'Personas Evacuadas': 'Personas evacuadas',
  'Personas Albergadas': 'Personas albergadas',
  'Personas en Familias Acogientes': 'En familias acogientes',
  'Personas Heridas': 'Personas heridas',
  'Personas Fallecidas': 'Personas fallecidas',
  'Personas Desaparecidas': 'Personas desaparecidas',
  'Viviendas Afectadas': 'Viviendas afectadas',
  'Viviendas Inhabitables': 'Viviendas inhabitables',
  'Edificaciones Públicas Afectadas': 'Edificaciones públicas afectadas',
  'Muelles y Embarcaderos Afectados': 'Muelles y embarcaderos afectados',
  'Cultivos Afectados (ha)': 'Cultivos afectados (hectáreas)',
  'Ganado Afectado': 'Ganado afectado',
  'Aves de Corral Afectadas': 'Aves de corral afectadas',
  'Comercios Afectados': 'Comercios afectados',
  'Servicios Turísticos Afectados': 'Servicios turísticos afectados',
  'Embarcaciones de Pesca Afectadas': 'Embarcaciones de pesca artesanal afectadas'
};

var DEFINICIONES = {
  'estado': {
    titulo: 'Estado del evento',
    items: [
      ['En curso', 'La afectación sigue creciendo o hay agua presente.'],
      ['En atención', 'Hay respuesta en el sitio, como bombeo, limpieza o albergue.'],
      ['Estabilizado', 'El agua se retiró y no hay evolución, pero persisten consecuencias, por ejemplo familias albergadas o servicios sin restablecer.'],
      ['Cerrado', 'Sin afectación vigente. El técnico no lo elige: solicita el cierre y el coordinador lo confirma.']
    ]
  },
  'personas': {
    titulo: 'Afectadas, damnificadas e impactadas',
    nota: 'Criterio operativo de los reportes de la SNGR.',
    items: [
      ['Afectadas', 'Sufren las consecuencias del evento pero conservan su vivienda habitable. Por ejemplo: daño parcial en la vivienda, pérdida de servicios básicos, cultivos o medios de vida, o incomunicación por una vía cortada.'],
      ['Damnificadas', 'Perdieron su vivienda, o quedó tan dañada que ya no pueden habitarla. Suelen necesitar alojamiento temporal o asistencia humanitaria mayor.'],
      ['Impactadas', 'No se registra: se calcula como afectadas más damnificadas.']
    ]
  },
  'viviendas': {
    titulo: 'Viviendas',
    items: [
      ['Afectadas', 'Con daño, pero se pueden seguir habitando.'],
      ['Inhabitables', 'Destruidas, o con un daño que impide habitarlas. Sus ocupantes se cuentan como damnificados.']
    ]
  },
  'cifras': {
    titulo: 'Sin dato y Ninguno',
    items: [
      ['Sin dato', 'No se conoce la cifra. No se suma en los totales y el visor lo muestra como sin dato.'],
      ['Ninguno', 'Se verificó que el valor es cero.']
    ]
  },
  'servicio': {
    titulo: 'Estado de los servicios',
    items: [
      ['Sin afectación', 'El servicio funciona con normalidad en el sitio.'],
      ['Afectación parcial', 'Funciona con cortes, baja presión o solo en parte del sitio.'],
      ['Sin servicio', 'No hay servicio en el sitio.'],
      ['Sin dato', 'No se pudo verificar.']
    ]
  },
  'via': {
    titulo: 'Vía de acceso al sitio',
    items: [
      ['Habilitada', 'Se circula con normalidad.'],
      ['Paso restringido', 'Un solo carril, o solo vehículos altos.'],
      ['Cerrada', 'No se puede circular.']
    ]
  },
  'cierre': {
    titulo: 'Solicitud de cierre',
    items: [
      ['Familias retornaron y servicios restablecidos', 'Ya no hay familias fuera de sus viviendas y los servicios funcionan.'],
      ['Afectación atendida', 'La respuesta terminó y no queda afectación vigente.'],
      ['Sin afectación verificada', 'Al llegar al sitio no se encontró afectación (falsa alarma).']
    ],
    nota: 'El evento sigue contando en los reportes hasta que el coordinador confirme el cierre.'
  },
  'baja': {
    titulo: 'Baja de una cifra de afectación',
    items: [
      ['Conteo depurado', 'Un conteo más preciso dio un número menor.'],
      ['Error de registro anterior', 'La visita anterior registró mal la cifra.'],
      ['Reubicación', 'Personas o familias pasaron a contarse en otro sitio.']
    ],
    nota: 'Las cifras de afectación normalmente solo suben o se mantienen. Si bajan, se debe indicar por qué.'
  }
};

// Islas para preseleccionar el cantón sin conexión (el técnico confirma la parroquia)
var ISLAS = [
  { canton: 'SANTA CRUZ', caja: [-90.60, -0.82, -90.12, -0.38] },   // Santa Cruz y Baltra
  { canton: 'SAN CRISTÓBAL', caja: [-89.68, -0.98, -89.20, -0.66] }, // San Cristóbal
  { canton: 'SAN CRISTÓBAL', caja: [-90.55, -1.38, -90.36, -1.20] }, // Floreana
  { canton: 'ISABELA', caja: [-91.70, -1.10, -90.75, 0.20] }         // Isabela y Fernandina
];

// Zonas pobladas para preparar el mapa sin conexión [oeste, sur, este, norte]
var ZONAS_MAPA = [
  { nombre: 'Puerto Ayora', caja: [-90.345, -0.765, -90.285, -0.720] },
  { nombre: 'Bellavista', caja: [-90.345, -0.705, -90.305, -0.675] },
  { nombre: 'Santa Rosa', caja: [-90.420, -0.670, -90.385, -0.640] },
  { nombre: 'Puerto Baquerizo Moreno', caja: [-89.630, -0.920, -89.590, -0.885] },
  { nombre: 'El Progreso', caja: [-89.565, -0.925, -89.530, -0.895] },
  { nombre: 'Puerto Villamil', caja: [-90.990, -0.970, -90.940, -0.940] },
  { nombre: 'Tomás de Berlanga', caja: [-91.045, -0.875, -91.000, -0.835] },
  { nombre: 'Puerto Velasco Ibarra (Floreana)', caja: [-90.500, -1.285, -90.475, -1.265] }
];
var ISLAS_MAPA = [
  [-90.60, -0.82, -90.12, -0.38], [-89.68, -0.98, -89.20, -0.66],
  [-90.55, -1.38, -90.36, -1.20], [-91.25, -1.10, -90.75, -0.75]
];
