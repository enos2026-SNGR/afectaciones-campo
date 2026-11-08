/* Listas cerradas y definiciones. Deben coincidir con CATALOGOS en el backend (Code.gs). */
var CATALOGOS = {
  'Tipo de Evento': ['Inundación', 'Movimiento en masa'],
  'Origen': ['Lluvia intensa', 'Oleaje o aguaje', 'Lluvia y oleaje combinados', 'No determinado'],
  'Nivel del Agua': ['Sin agua', 'Hasta el tobillo (menos de 0,30 m)', 'Hasta la rodilla (0,30 a 0,50 m)',
                     'Hasta la cintura (0,50 a 1 m)', 'Sobre la cintura (más de 1 m)'],
  'Tendencia del Agua': ['Subiendo', 'Estable', 'Bajando', 'Sin agua'],
  'Estado del Evento': ['Activo', 'Sin evolución'],
  'Afectación': ['Sí', 'No', 'No se pudo verificar'],
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
  'Tipo Geometría': ['Zona afectada', 'Tramo de vía', 'Cauce desbordado', 'Punto crítico'],
  'Detalle Punto Crítico': ['Vivienda afectada', 'Alcantarilla o sumidero obstruido', 'Deslizamiento', 'Hundimiento o socavón', 'Infraestructura pública afectada', 'Otro']
};

// Desde la versión 2.1 la ficha no pide cifras de personas ni viviendas: solo si hay afectación (Sí, No, No se pudo verificar)
var CIFRAS_OBLIGATORIAS = [];

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
      ['Activo', 'El fenómeno continúa: el agua está presente o sigue subiendo, o el terreno sigue en movimiento.'],
      ['Sin evolución', 'El fenómeno se detuvo, aunque persistan sus consecuencias.']
    ],
    nota: 'Describe el fenómeno, no la respuesta. Si cambia, se registra con una actualización del evento.'
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
    nota: 'El evento sigue contando en los reportes hasta que el administrador confirme el cierre.'
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

