import { describe, expect, it } from 'vitest';
import {
  getBusinessTemplate,
  templateStages,
  validStageNames,
} from './catalog';
describe('business templates', () => {
  it('keeps blank businesses free of seeded stages', () =>
    expect(templateStages('blank', 'sell')).toEqual([]));
  it('adapts stages to the operational objective', () => {
    expect(templateStages('generic', 'schedule')).toContain('Cita realizada');
    expect(templateStages('real_estate', 'capture')).toContain(
      'Propiedad captada'
    );
    expect(templateStages('real_estate', 'rent')).toContain('Visita');
  });
  it('rejects unknown templates and duplicate or invalid stages', () => {
    expect(getBusinessTemplate('forged')).toBeUndefined();
    expect(validStageNames(['Consulta', ' consulta '], 'generic')).toBe(false);
    expect(validStageNames(['Consulta', ''], 'real_estate')).toBe(false);
    expect(validStageNames(['Consulta', 'Cierre'], 'generic')).toBe(true);
    expect(validStageNames(['Consulta'], 'blank')).toBe(false);
  });
});
