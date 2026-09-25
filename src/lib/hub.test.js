import { describe, it, expect } from 'vitest';
import { cleanItem, driverView, emptyHub, equipmentView, mergeGroups, splitRecord, syncRecords, viewForApp, HubError } from './hub.js';

let n = 0;
const newId = () => `id${++n}`;
const TODAY = '2026-09-25';

const tms = { id: 'tms', name: 'TMS Truck', scopes: ['drivers:write', 'drivers:read', 'equipment:write', 'equipment:read'] };
const nec = { id: 'nec', name: 'NEC Compliance', scopes: ['drivers:write', 'qualification:write'] };
const pbn = { id: 'pbn', name: "Newman's", scopes: ['drivers:write', 'equipment:write'] };

function hub() {
  return { ...emptyHub(), connections: [tms, nec, pbn] };
}
const sync = (state, conn, collection, items) => syncRecords(state, conn, collection, items, { newId, now: `2026-09-25T12:00:0${n % 10}Z` });

describe('cleaning what apps send', () => {
  it('keeps known fields, drops private and unknown ones', () => {
    const { fields, ignored, invalid } = cleanItem(
      {
        externalId: '1',
        firstName: ' Jose ',
        lastName: 'Rivera',
        phone: '(973) 555-0101',
        licenseNumber: 'R123',
        birthDate: '1984-05-12',
        medicalExpiry: '2026-13-01',
        color: 'red',
      },
      { firstName: 'text', lastName: 'text', name: 'text', phone: 'phone', medicalExpiry: 'date' },
    );
    expect(fields).toEqual({ firstName: 'Jose', lastName: 'Rivera', name: 'Jose Rivera', phone: '9735550101' });
    expect(ignored.sort()).toEqual(['birthDate', 'color', 'licenseNumber']);
    expect(invalid).toEqual(['medicalExpiry']);
  });

  it('never stores license numbers or birth dates, even from the compliance app', () => {
    const { state, summary } = sync(hub(), nec, 'drivers', [
      { externalId: 'E1', name: 'Jose Rivera', licenseNumber: 'R1234', dateOfBirth: '1984-05-12' },
    ]);
    expect(JSON.stringify(state)).not.toContain('R1234');
    expect(JSON.stringify(state)).not.toContain('1984-05-12');
    expect(summary.ignoredFields).toEqual(['dateOfBirth', 'licenseNumber']);
  });

  it('only the compliance app may set qualification', () => {
    const { state, summary } = sync(hub(), tms, 'drivers', [{ externalId: 'd1', name: 'Jose Rivera', qualificationStatus: 'qualified' }]);
    expect(state.drivers[0].fields.qualificationStatus).toBeUndefined();
    expect(summary.ignoredFields).toEqual(['qualificationStatus']);
  });

  it('refuses bad lists', () => {
    expect(() => sync(hub(), tms, 'drivers', 'nope')).toThrow(HubError);
    expect(() => sync(hub(), tms, 'drivers', [{ name: 'No id' }])).toThrow(/externalId/);
    expect(() =>
      sync(hub(), tms, 'drivers', [
        { externalId: '1', name: 'A' },
        { externalId: '1', name: 'B' },
      ]),
    ).toThrow(/twice/);
    expect(() => sync(hub(), tms, 'equipment', [{ externalId: '1', unit: '101' }])).toThrow(/kind/);
  });
});

describe('matching the same driver across apps', () => {
  it('matches by phone, then employee id, then a unique name', () => {
    let s = sync(hub(), tms, 'drivers', [
      { externalId: 'd1', firstName: 'Jose', lastName: 'Rivera', phone: '973 555 0101' },
      { externalId: 'd2', firstName: 'Kevin', lastName: 'Brown', employeeId: 'E-22' },
      { externalId: 'd3', firstName: 'Tanya', lastName: 'Wells' },
    ]).state;
    s = sync(s, pbn, 'drivers', [
      { externalId: '7', name: 'J. Rivera', phone: '+1 (973) 555-0101' },
      { externalId: '8', name: 'TANYA  WELLS' },
    ]).state;
    s = sync(s, nec, 'drivers', [{ externalId: 'E-22', name: 'Kevin Brown', employeeId: 'e-22', qualificationStatus: 'qualified' }]).state;
    const view = driverView(s, { today: TODAY });
    expect(view).toHaveLength(3);
    expect(
      view
        .find((d) => d.name === 'Jose Rivera')
        .sources.map((x) => x.source)
        .sort(),
    ).toEqual(['pbn', 'tms']);
    expect(view.find((d) => d.name === 'Tanya Wells').sources).toHaveLength(2);
    expect(view.find((d) => d.name === 'Kevin Brown').qualification.status).toBe('qualified');
  });

  it('does not join when a name fits more than one driver', () => {
    let s = sync(hub(), tms, 'drivers', [{ externalId: 'a', name: 'Luis Vega' }]).state;
    s = sync(s, pbn, 'drivers', [{ externalId: 'b', name: 'Luis Vega' }]).state;
    // A second TMS driver with the same name makes the name ambiguous for a third app.
    s = sync(s, tms, 'drivers', [
      { externalId: 'a', name: 'Luis Vega' },
      { externalId: 'c', name: 'Luis Vega' },
    ]).state;
    s = sync(s, nec, 'drivers', [{ externalId: 'x', name: 'Luis Vega' }]).state;
    const necRecord = s.drivers.find((r) => r.source === 'nec');
    expect(s.drivers.filter((r) => r.groupId === necRecord.groupId)).toHaveLength(1);
  });

  it('never puts two records from the same app in one group', () => {
    const s = sync(hub(), tms, 'drivers', [
      { externalId: 'a', name: 'Same Name', phone: '9735550000' },
      { externalId: 'b', name: 'Same Name', phone: '9735550000' },
    ]).state;
    expect(new Set(s.drivers.map((r) => r.groupId)).size).toBe(2);
  });

  it('updates, keeps and removes records on the next sync', () => {
    let r = sync(hub(), tms, 'drivers', [
      { externalId: 'a', name: 'A One' },
      { externalId: 'b', name: 'B Two' },
    ]);
    expect(r.summary).toMatchObject({ added: 2, updated: 0, removed: 0 });
    const groupA = r.state.drivers[0].groupId;
    r = sync(r.state, tms, 'drivers', [{ externalId: 'a', name: 'A One', phone: '2015550000' }]);
    expect(r.summary).toMatchObject({ added: 0, updated: 1, unchanged: 0, removed: 1 });
    expect(r.state.drivers).toHaveLength(1);
    expect(r.state.drivers[0].groupId).toBe(groupA);
    r = sync(r.state, tms, 'drivers', [{ externalId: 'a', name: 'A One', phone: '2015550000' }]);
    expect(r.summary).toMatchObject({ added: 0, updated: 0, unchanged: 1, removed: 0 });
  });

  it('join and separate by hand', () => {
    let s = sync(hub(), tms, 'drivers', [{ externalId: 'a', name: 'Jose Rivera' }]).state;
    s = sync(s, pbn, 'drivers', [{ externalId: '1', name: 'Pepe Rivera' }]).state;
    const [g1, g2] = [...new Set(s.drivers.map((r) => r.groupId))];
    s = mergeGroups(s, 'drivers', g2, g1);
    expect(new Set(s.drivers.map((r) => r.groupId)).size).toBe(1);
    const pbnRecord = s.drivers.find((r) => r.source === 'pbn');
    s = splitRecord(s, 'drivers', pbnRecord.id, 'new-group');
    expect(new Set(s.drivers.map((r) => r.groupId)).size).toBe(2);
    expect(() => splitRecord(s, 'drivers', pbnRecord.id, 'x')).toThrow(/own/);
    let t = sync(hub(), tms, 'drivers', [
      { externalId: 'a', name: 'X' },
      { externalId: 'b', name: 'Y' },
    ]).state;
    expect(() => mergeGroups(t, 'drivers', t.drivers[0].groupId, t.drivers[1].groupId)).toThrow(/same app/);
  });
});

describe('combined driver view', () => {
  it('prefers the compliance app for the medical card and flags disagreements and dates', () => {
    let s = sync(hub(), tms, 'drivers', [
      { externalId: 'a', name: 'Kevin Brown', phone: '9735550102', medicalExpiry: '2026-12-01', licenseExpiry: '2026-10-05', status: 'Active' },
    ]).state;
    s = sync(s, nec, 'drivers', [
      { externalId: 'E1', name: 'Kevin Brown', phone: '9735550102', medicalExpiry: '2026-09-20', qualificationStatus: 'disqualified' },
    ]).state;
    const [d] = driverView(s, { names: { tms: 'TMS Truck', nec: 'NEC' }, today: TODAY });
    expect(d.medicalExpiry).toBe('2026-09-20');
    expect(d.mismatches.map((m) => m.field)).toEqual(['medicalExpiry']);
    const texts = d.alerts.map((a) => a.text);
    expect(texts).toContain('Disqualified, may not drive');
    expect(texts.some((t) => t.startsWith('Medical card expired'))).toBe(true);
    expect(texts.some((t) => t.startsWith('CDL expires in 10 days'))).toBe(true);
    expect(texts).toContain('Apps disagree on medical card');
  });

  it('shows no alerts for inactive drivers', () => {
    const s = sync(hub(), tms, 'drivers', [{ externalId: 'a', name: 'Old Driver', medicalExpiry: '2020-01-01', status: 'Inactive' }]).state;
    expect(driverView(s, { today: TODAY })[0].alerts).toEqual([]);
  });

  it('an app reads only its own drivers, with its own id, unless it asks for all', () => {
    let s = sync(hub(), tms, 'drivers', [{ externalId: 'd1', name: 'Jose Rivera', phone: '9735550101' }]).state;
    s = sync(s, nec, 'drivers', [
      { externalId: 'E1', name: 'Jose Rivera', phone: '9735550101', qualificationStatus: 'qualified' },
      { externalId: 'E2', name: 'Only Nec' },
    ]).state;
    const view = driverView(s, { names: { tms: 'TMS Truck', nec: 'NEC' }, today: TODAY });
    const mine = viewForApp(view, 'tms');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ yourId: 'd1', qualification: { status: 'qualified' } });
    expect(mine[0].sources).toBeUndefined();
    expect(viewForApp(view, 'tms', { all: true })).toHaveLength(2);
  });
});

describe('equipment', () => {
  it('matches by VIN, then plate, and warns about dates', () => {
    let s = sync(hub(), tms, 'equipment', [
      { externalId: 't1', kind: 'truck', unit: '101', vin: '3akjhhdr5nsna1011', plateExpiry: '2026-10-01' },
      { externalId: 'r1', kind: 'trailer', unit: '5301', plate: 'p5301', plateState: 'nj' },
    ]).state;
    s = sync(s, pbn, 'equipment', [
      { externalId: '9', kind: 'truck', unit: '11', vin: '3AKJHHDR5NSNA1011', plateExpiry: '2026-10-01' },
      { externalId: '10', kind: 'trailer', unit: 'R-5301', plate: 'P5301', plateState: 'NJ', inspectionDue: '2026-09-01' },
      { externalId: '11', kind: 'truck', unit: '5301', plate: 'P5301', plateState: 'NJ' },
    ]).state;
    const view = equipmentView(s, { today: TODAY });
    expect(view).toHaveLength(3);
    const truck = view.find((v) => v.vin === '3AKJHHDR5NSNA1011');
    expect(truck.sources).toHaveLength(2);
    expect(truck.mismatches.map((m) => m.field)).toEqual(['unit']);
    expect(truck.alerts.map((a) => a.text)).toContain('Registration expires in 6 days (Oct 1, 2026)');
    const trailer = view.find((v) => v.kind === 'trailer');
    expect(trailer.sources).toHaveLength(2);
    expect(trailer.alerts.some((a) => a.text.startsWith('Annual inspection expired'))).toBe(true);
  });
});
