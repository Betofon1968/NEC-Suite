// The data hub: every connected app sends its own drivers and equipment here, and the
// suite matches the records that describe the same person or the same truck.
//
// Each record keeps the app it came from (source) and that app's own id (externalId).
// Records that describe the same driver share a groupId; same for trucks and trailers.
// Everything here is a pure function, used by the server and tested on its own.
import { date, daysUntil, formatPhone, todayISO } from './format.js';

export class HubError extends Error {}
const fail = (message) => {
  throw new HubError(message);
};

export const SCOPES = {
  'drivers:write': 'Send its drivers',
  'qualification:write': 'Send driver qualification (compliance app only)',
  'drivers:read': 'Read drivers',
  'equipment:write': 'Send its trucks and trailers',
  'equipment:read': 'Read trucks and trailers',
};

// The same statuses NEC Trucking Compliance derives in its mvr.driver_qualification view.
export const QUALIFICATION_STATUSES = {
  qualified: 'Qualified',
  conditional: 'Conditional',
  pending_review: 'Pending review',
  disqualified: 'Disqualified',
};
export const MAX_ITEMS = 5000;
export const SOON_DAYS = 30;

// Fields the hub keeps, with their type. Anything else an app sends is ignored.
const DRIVER_FIELDS = {
  firstName: 'text',
  lastName: 'text',
  name: 'text',
  phone: 'phone',
  email: 'email',
  status: 'text',
  driverType: 'text',
  employeeId: 'text',
  cdlClass: 'text',
  endorsements: 'codes',
  licenseState: 'state',
  licenseExpiry: 'date',
  medicalExpiry: 'date',
  hireDate: 'date',
  truckUnit: 'text',
};
// Only an app with the qualification:write permission (the compliance app) may set these.
const QUALIFICATION_FIELDS = { qualificationStatus: 'qualification', lastReviewedOn: 'date', nextCheckOn: 'date' };
const EQUIPMENT_FIELDS = {
  kind: 'kind',
  unit: 'text',
  vin: 'vin',
  plate: 'upper',
  plateState: 'state',
  plateExpiry: 'date',
  inspectionDue: 'date',
  insuranceName: 'text',
  insuranceExpiry: 'date',
  make: 'text',
  model: 'text',
  year: 'year',
  equipmentType: 'text',
  ownership: 'text',
  status: 'text',
};

// Private driver data (Driver's Privacy Protection Act). It stays in the app that owns it and
// is dropped here even if an app sends it by mistake.
export const PRIVATE_FIELDS = [
  'licenseNumber',
  'license_number',
  'birthDate',
  'dateOfBirth',
  'date_of_birth',
  'dob',
  'ssn',
  'socialSecurityNumber',
  'mvr',
  'abstract',
];

export const FIELD_LABELS = {
  phone: 'Phone',
  email: 'Email',
  medicalExpiry: 'Medical card',
  licenseExpiry: 'CDL expiry',
  licenseState: 'License state',
  cdlClass: 'CDL class',
  unit: 'Unit number',
  vin: 'VIN',
  plate: 'Plate',
  plateExpiry: 'Registration',
  inspectionDue: 'Annual inspection',
  insuranceExpiry: 'Insurance',
};

export function emptyHub() {
  return { schema: 1, apps: [], connections: [], drivers: [], equipment: [], activity: [] };
}

/* ---------- Cleaning what apps send ---------- */

function cleanValue(type, value) {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'object' && type !== 'codes') return null;
  const s = String(value).trim();
  switch (type) {
    case 'text':
      return s.slice(0, 200) || undefined;
    case 'upper':
      return s.slice(0, 40).toUpperCase() || undefined;
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 120 ? s.toLowerCase() : null;
    case 'state':
      return /^[A-Za-z]{2}$/.test(s) ? s.toUpperCase() : null;
    case 'date': {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
      if (!m) return null;
      const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
      return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? m[0] : null;
    }
    case 'phone': {
      const digits = s.replace(/\D/g, '');
      return digits.length >= 10 ? digits.slice(-10) : null;
    }
    case 'codes': {
      if (!Array.isArray(value)) return null;
      const codes = value.map((c) => String(c).trim().toUpperCase()).filter((c) => /^[A-Z]{1,3}$/.test(c));
      return codes.length ? [...new Set(codes)].sort().slice(0, 10) : undefined;
    }
    case 'vin': {
      const v = s.toUpperCase().replace(/[\s-]/g, '');
      return /^[A-Z0-9]{5,17}$/.test(v) ? v : null;
    }
    case 'year': {
      const y = Number(s);
      return Number.isInteger(y) && y >= 1950 && y <= 2100 ? y : null;
    }
    case 'kind': {
      const k = s.toLowerCase();
      return k === 'truck' || k === 'trailer' ? k : null;
    }
    case 'qualification':
      return Object.hasOwn(QUALIFICATION_STATUSES, s) ? s : null;
    default:
      return null;
  }
}

// Returns the fields the hub keeps plus the names it dropped (not allowed) or could not read.
export function cleanItem(item, allowed) {
  const fields = {};
  const ignored = [];
  const invalid = [];
  for (const [key, value] of Object.entries(item)) {
    if (key === 'externalId') continue;
    if (!Object.hasOwn(allowed, key)) {
      ignored.push(key);
      continue;
    }
    const v = cleanValue(allowed[key], value);
    if (v === null) invalid.push(key);
    else if (v !== undefined) fields[key] = v;
  }
  if (!fields.name && (fields.firstName || fields.lastName)) fields.name = [fields.firstName, fields.lastName].filter(Boolean).join(' ');
  return { fields, ignored, invalid };
}

function allowedFields(collection, scopes) {
  if (collection === 'equipment') return EQUIPMENT_FIELDS;
  return scopes.includes('qualification:write') ? { ...DRIVER_FIELDS, ...QUALIFICATION_FIELDS } : DRIVER_FIELDS;
}

/* ---------- Matching the same driver or truck across apps ---------- */

export function nameKey(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Ways two records can be recognized as the same driver or unit, strongest first. A
// match only counts when exactly one existing group fits, so a common name never joins
// two different people.
const MATCHERS = {
  drivers: [
    (f) => (f.phone ? `phone:${f.phone}` : null),
    (f) => (f.employeeId ? `emp:${f.employeeId.toLowerCase()}` : null),
    (f) => (nameKey(f.name) ? `name:${nameKey(f.name)}` : null),
  ],
  equipment: [(f) => (f.vin ? `vin:${f.vin}` : null), (f) => (f.plate && f.plateState ? `plate:${f.kind}:${f.plateState}:${f.plate}` : null)],
};

function findGroup(records, collection, source, fields) {
  // A group already holding a record from the same app is a different driver or unit.
  const taken = new Set(records.filter((r) => r.source === source).map((r) => r.groupId));
  const pool = records.filter((r) => !taken.has(r.groupId) && (collection !== 'equipment' || r.fields.kind === fields.kind));
  for (const key of MATCHERS[collection]) {
    const k = key(fields);
    if (!k) continue;
    const groups = new Set(pool.filter((r) => key(r.fields) === k).map((r) => r.groupId));
    if (groups.size === 1) return [...groups][0];
  }
  return null;
}

const sameFields = (a, b) => JSON.stringify(a, Object.keys(a).sort()) === JSON.stringify(b, Object.keys(b).sort());

// Replaces everything one app has sent for a collection with its current list. Records the
// app no longer sends are removed, so a driver deleted in the app leaves the hub too.
export function syncRecords(state, connection, collection, items, { now = new Date().toISOString(), newId }) {
  if (collection !== 'drivers' && collection !== 'equipment') fail('Unknown collection.');
  if (!Array.isArray(items)) fail(`Send "${collection}" as a list.`);
  if (items.length > MAX_ITEMS) fail(`Send at most ${MAX_ITEMS} records at a time.`);
  const allowed = allowedFields(collection, connection.scopes || []);
  const seen = new Set();
  const cleaned = items.map((item, i) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail(`Record ${i + 1} is not an object.`);
    const externalId = String(item.externalId ?? '').trim();
    if (!externalId || externalId.length > 100) fail(`Record ${i + 1} needs an externalId (the app's own id, up to 100 characters).`);
    if (seen.has(externalId)) fail(`The externalId ${externalId} is sent twice.`);
    seen.add(externalId);
    const c = cleanItem(item, allowed);
    if (collection === 'equipment' && !c.fields.kind) fail(`Record ${externalId} needs kind "truck" or "trailer".`);
    if (collection === 'drivers' && !c.fields.name && !c.fields.employeeId) fail(`Driver ${externalId} needs a name.`);
    if (collection === 'equipment' && !c.fields.unit && !c.fields.vin) fail(`Unit ${externalId} needs a unit number or VIN.`);
    return { externalId, ...c };
  });

  const summary = { added: 0, updated: 0, unchanged: 0, removed: 0, ignoredFields: [], invalidFields: [] };
  const ignored = new Set();
  const invalid = new Set();
  const mine = new Map(state[collection].filter((r) => r.source === connection.id).map((r) => [r.externalId, r]));
  let records = state[collection].filter((r) => r.source !== connection.id || seen.has(r.externalId));
  summary.removed = state[collection].length - records.length;

  const fresh = [];
  for (const c of cleaned) {
    c.ignored.forEach((f) => ignored.add(f));
    c.invalid.forEach((f) => invalid.add(f));
    const existing = mine.get(c.externalId);
    if (!existing) {
      fresh.push(c);
    } else if (sameFields(existing.fields, c.fields)) {
      summary.unchanged += 1;
    } else {
      summary.updated += 1;
      records = records.map((r) => (r === existing ? { ...r, fields: c.fields, updatedAt: now } : r));
    }
  }
  // New records are matched against everything else, including each other.
  for (const c of fresh) {
    const groupId = findGroup(records, collection, connection.id, c.fields) || newId();
    records = [...records, { id: newId(), source: connection.id, externalId: c.externalId, groupId, fields: c.fields, updatedAt: now }];
    summary.added += 1;
  }
  summary.ignoredFields = [...ignored].sort();
  summary.invalidFields = [...invalid].sort();
  return { state: { ...state, [collection]: records }, summary };
}

// Joins two groups the matching did not recognize as the same driver or unit.
export function mergeGroups(state, collection, fromGroupId, intoGroupId) {
  const records = state[collection];
  const from = records.filter((r) => r.groupId === fromGroupId);
  const into = records.filter((r) => r.groupId === intoGroupId);
  if (!from.length || !into.length || fromGroupId === intoGroupId) fail('Pick two different records to join.');
  const clash = from.find((r) => into.some((o) => o.source === r.source));
  if (clash) fail('Both already have a record from the same app. Remove the duplicate in that app first.');
  return { ...state, [collection]: records.map((r) => (r.groupId === fromGroupId ? { ...r, groupId: intoGroupId } : r)) };
}

// Takes one app's record out of a group that joined it by mistake.
export function splitRecord(state, collection, recordId, newGroupId) {
  const record = state[collection].find((r) => r.id === recordId);
  if (!record) fail('Record not found.');
  if (state[collection].filter((r) => r.groupId === record.groupId).length < 2) fail('This record is already on its own.');
  return { ...state, [collection]: state[collection].map((r) => (r.id === recordId ? { ...r, groupId: newGroupId } : r)) };
}

/* ---------- One combined view per driver or unit ---------- */

const INACTIVE = /inactive|terminat|archiv|sold|retired|dispos|former|out of service/i;
export const isActive = (status) => !INACTIVE.test(String(status || ''));

function dateAlert(label, value, today, field) {
  const d = daysUntil(value, today);
  if (d === null) return null;
  if (d < 0) return { level: 'red', field, text: `${label} expired ${date(value)}` };
  if (d <= SOON_DAYS)
    return { level: 'amber', field, text: `${label} expires ${d === 0 ? 'today' : `in ${d} day${d === 1 ? '' : 's'}`} (${date(value)})` };
  return null;
}

function groupBy(records) {
  const groups = new Map();
  for (const r of records) {
    if (!groups.has(r.groupId)) groups.set(r.groupId, []);
    groups.get(r.groupId).push(r);
  }
  // Newest first, so the latest change wins when two apps disagree.
  for (const list of groups.values()) list.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || a.source.localeCompare(b.source));
  return groups;
}

function mismatches(records, fields, names, show = (f, v) => v) {
  const out = [];
  for (const field of fields) {
    const values = records
      .filter((r) => r.fields[field] !== undefined)
      .map((r) => ({ app: names[r.source] || r.source, value: show(field, r.fields[field]) }));
    if (new Set(values.map((v) => String(v.value))).size > 1) out.push({ field, label: FIELD_LABELS[field] || field, values });
  }
  return out;
}

const showValue = (field, v) => (field === 'phone' ? formatPhone(v) : /Expiry|Due$/.test(field) ? date(v) : v);

// names: connection id -> app name, for labels.
export function driverView(state, { names = {}, today = todayISO() } = {}) {
  const qualifiers = new Set(state.connections.filter((c) => (c.scopes || []).includes('qualification:write')).map((c) => c.id));
  const out = [];
  for (const [groupId, records] of groupBy(state.drivers)) {
    const pick = (field, list = records) => list.find((r) => r.fields[field] !== undefined)?.fields[field];
    // The compliance app is the authority on qualification and on the medical card date.
    const compliance = records.filter((r) => qualifiers.has(r.source));
    const qualRecord = compliance.find((r) => r.fields.qualificationStatus);
    const v = {
      id: groupId,
      name: pick('name') || pick('employeeId'),
      firstName: pick('firstName'),
      lastName: pick('lastName'),
      phone: pick('phone'),
      email: pick('email'),
      status: pick('status') || 'Active',
      driverType: pick('driverType'),
      cdlClass: pick('cdlClass'),
      licenseState: pick('licenseState'),
      licenseExpiry: pick('licenseExpiry', [...compliance, ...records]),
      medicalExpiry: pick('medicalExpiry', [...compliance, ...records]),
      truckUnit: pick('truckUnit'),
      qualification: qualRecord
        ? {
            status: qualRecord.fields.qualificationStatus,
            label: QUALIFICATION_STATUSES[qualRecord.fields.qualificationStatus],
            lastReviewedOn: qualRecord.fields.lastReviewedOn || null,
            nextCheckOn: qualRecord.fields.nextCheckOn || null,
            app: names[qualRecord.source] || qualRecord.source,
            updatedAt: qualRecord.updatedAt,
          }
        : null,
      sources: records.map((r) => ({
        recordId: r.id,
        source: r.source,
        app: names[r.source] || r.source,
        externalId: r.externalId,
        updatedAt: r.updatedAt,
      })),
      mismatches: mismatches(records, ['phone', 'medicalExpiry', 'licenseExpiry', 'licenseState', 'cdlClass'], names, showValue),
    };
    v.active = isActive(v.status);
    const alerts = [];
    if (v.active) {
      if (v.qualification?.status === 'disqualified') alerts.push({ level: 'red', field: 'qualification', text: 'Disqualified, may not drive' });
      if (v.qualification?.status === 'pending_review') alerts.push({ level: 'amber', field: 'qualification', text: 'Qualification review pending' });
      const med = dateAlert('Medical card', v.medicalExpiry, today, 'medicalExpiry');
      const cdl = dateAlert('CDL', v.licenseExpiry, today, 'licenseExpiry');
      if (med) alerts.push(med);
      if (cdl) alerts.push(cdl);
      for (const m of v.mismatches) alerts.push({ level: 'amber', field: m.field, text: `Apps disagree on ${m.label.toLowerCase()}` });
    }
    v.alerts = alerts;
    out.push(v);
  }
  return out.sort(
    (a, b) => nameKey(a.lastName || a.name).localeCompare(nameKey(b.lastName || b.name)) || nameKey(a.name).localeCompare(nameKey(b.name)),
  );
}

export function equipmentView(state, { names = {}, today = todayISO() } = {}) {
  const out = [];
  for (const [groupId, records] of groupBy(state.equipment)) {
    const pick = (field) => records.find((r) => r.fields[field] !== undefined)?.fields[field];
    const v = {
      id: groupId,
      kind: pick('kind'),
      unit: pick('unit'),
      vin: pick('vin'),
      plate: pick('plate'),
      plateState: pick('plateState'),
      make: pick('make'),
      model: pick('model'),
      year: pick('year'),
      equipmentType: pick('equipmentType'),
      ownership: pick('ownership'),
      status: pick('status') || 'Active',
      plateExpiry: pick('plateExpiry'),
      inspectionDue: pick('inspectionDue'),
      insuranceName: pick('insuranceName'),
      insuranceExpiry: pick('insuranceExpiry'),
      sources: records.map((r) => ({
        recordId: r.id,
        source: r.source,
        app: names[r.source] || r.source,
        externalId: r.externalId,
        updatedAt: r.updatedAt,
      })),
      mismatches: mismatches(records, ['unit', 'vin', 'plate', 'plateExpiry', 'inspectionDue', 'insuranceExpiry'], names, showValue),
    };
    v.active = isActive(v.status);
    const alerts = [];
    if (v.active) {
      for (const [field, label] of [
        ['plateExpiry', 'Registration'],
        ['inspectionDue', 'Annual inspection'],
        ['insuranceExpiry', 'Insurance'],
      ]) {
        const a = dateAlert(label, v[field], today, field);
        if (a) alerts.push(a);
      }
      for (const m of v.mismatches) alerts.push({ level: 'amber', field: m.field, text: `Apps disagree on ${m.label.toLowerCase()}` });
    }
    v.alerts = alerts;
    out.push(v);
  }
  const unitKey = (u) => String(u.unit || u.vin || '').padStart(12, '0');
  return out.sort((a, b) => a.kind.localeCompare(b.kind) * -1 || unitKey(a).localeCompare(unitKey(b)));
}

// What one app gets back when it reads: only the drivers or units it also has (unless it
// asks for all), with its own id on each so it can find them in its records.
export function viewForApp(view, connectionId, { all = false } = {}) {
  return view
    .map((v) => {
      const own = v.sources.find((s) => s.source === connectionId);
      if (!own && !all) return null;
      const { sources, ...rest } = v;
      return { ...rest, yourId: own ? own.externalId : null, apps: [...new Set(sources.map((s) => s.app))] };
    })
    .filter(Boolean);
}
