export const OBJECTIVES = [
  { id: 'sell', label: 'Cerrar ventas' },
  { id: 'schedule', label: 'Agendar y completar citas' },
  { id: 'rent', label: 'Cerrar alquileres' },
  { id: 'capture', label: 'Captar propietarios' },
] as const;
export type BusinessObjective = (typeof OBJECTIVES)[number]['id'];
export const BUSINESS_TEMPLATES = [
  {
    id: 'generic',
    version: 1,
    name: 'General',
    objectives: ['sell', 'schedule'],
    fields: ['Necesidad principal', 'Presupuesto'],
    stages: ['Consulta', 'Calificación', 'Propuesta', 'Negociación', 'Cierre'],
    description: 'Un proceso adaptable a cualquier negocio.',
  },
  {
    id: 'real_estate',
    version: 1,
    name: 'Inmobiliaria',
    objectives: ['sell', 'rent', 'capture'],
    fields: [
      'Tipo de interesado',
      'Zona de interés',
      'Presupuesto',
      'Tipo de inmueble',
    ],
    stages: [
      'Consulta',
      'Calificación',
      'Visita',
      'Oferta',
      'Negociación',
      'Cierre',
    ],
    description:
      'Organiza interesados y oportunidades. El inventario de propiedades aún no está disponible.',
  },
  {
    id: 'blank',
    version: 1,
    name: 'Desde cero',
    objectives: ['sell', 'schedule', 'rent', 'capture'],
    fields: [],
    stages: [],
    description: 'Crea un negocio sin etapas ni campos preconfigurados.',
  },
] as const;
export type BusinessTemplateId = (typeof BUSINESS_TEMPLATES)[number]['id'];
export function getBusinessTemplate(id: unknown) {
  return BUSINESS_TEMPLATES.find((template) => template.id === id);
}
export function templateStages(
  id: BusinessTemplateId,
  objective: BusinessObjective
): string[] {
  if (id === 'blank') return [];
  if (id === 'generic' && objective === 'schedule')
    return ['Consulta', 'Calificación', 'Cita agendada', 'Cita realizada'];
  if (id === 'real_estate' && objective === 'capture')
    return [
      'Consulta',
      'Calificación',
      'Evaluación',
      'Acuerdo',
      'Propiedad captada',
    ];
  return [...getBusinessTemplate(id)!.stages];
}
export function validStageNames(
  value: unknown,
  templateId: BusinessTemplateId
): value is string[] {
  return (
    Array.isArray(value) &&
    (templateId === 'blank'
      ? value.length === 0
      : value.length >= 2 && value.length <= 12) &&
    value.every(
      (name) =>
        typeof name === 'string' &&
        name.trim().length > 0 &&
        name.trim().length <= 60
    ) &&
    new Set(value.map((name) => name.trim().toLowerCase())).size ===
      value.length
  );
}
