/** Interpret a datetime-local as the business wall time, not the browser zone. */
export function localToInstant(value: string, timezone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error('Fecha y hora no válidas');
  const parts = value.match(/\d+/g)!.map(Number);
  const target = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4]);
  if (new Date(target).toISOString().slice(0, 16) !== value)
    throw new Error('Fecha y hora no válidas');
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const wall = (instant: number) => {
    const p = Object.fromEntries(
      formatter.formatToParts(instant).map((x) => [x.type, x.value])
    );
    return Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute)
    );
  };
  let instant = target;
  for (let i = 0; i < 3; i++) instant += target - wall(instant);
  if (wall(instant) !== target)
    throw new Error('Ese horario no existe en la zona horaria del negocio.');
  for (const offset of [120, 90, 60, 30])
    if (wall(instant - offset * 60000) === target) {
      instant -= offset * 60000;
      break;
    }
  return new Date(instant).toISOString();
}
