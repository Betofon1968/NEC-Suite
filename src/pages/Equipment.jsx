import { SharedRecords, Expiry, needsAttention } from '../components/Shared.jsx';
import { Badge } from '../components/ui.jsx';

const KIND = { truck: 'Truck', trailer: 'Trailer' };
const labelOf = (u) => `${KIND[u.kind]} ${u.unit || u.vin || ''}`.trim();
const plate = (u) => [u.plateState, u.plate].filter(Boolean).join(' ');

const COLUMNS = [
  { header: 'Unit', render: (u) => <strong className="nowrap">{labelOf(u)}</strong> },
  { header: 'Make / model', render: (u) => [u.year, u.make, u.model].filter(Boolean).join(' ') },
  { header: 'Plate', render: (u) => <span className="nowrap">{plate(u)}</span> },
  { header: 'Registration', render: (u) => <Expiry value={u.plateExpiry} /> },
  { header: 'Inspection', render: (u) => <Expiry value={u.inspectionDue} due /> },
  { header: 'Insurance', render: (u) => <Expiry value={u.insuranceExpiry} /> },
];

const DETAILS = [
  ['Status', (u) => <Badge>{u.status}</Badge>],
  ['Type', (u) => u.equipmentType],
  ['Make / model', (u) => [u.year, u.make, u.model].filter(Boolean).join(' ')],
  ['VIN', (u) => u.vin],
  ['Plate', plate],
  ['Ownership', (u) => u.ownership],
  ['Registration', (u) => u.plateExpiry && <Expiry value={u.plateExpiry} />],
  ['Annual inspection', (u) => u.inspectionDue && <Expiry value={u.inspectionDue} due />],
  [
    'Insurance',
    (u) =>
      [u.insuranceName, u.insuranceExpiry && <Expiry key="e" value={u.insuranceExpiry} />].filter(Boolean).map((x, i) => <span key={i}>{x} </span>),
  ],
];

const TABS = [
  { value: 'trucks', label: 'Trucks', filter: (u) => u.kind === 'truck' && u.active },
  { value: 'trailers', label: 'Trailers', filter: (u) => u.kind === 'trailer' && u.active },
  { value: 'attention', label: 'Needs attention', filter: needsAttention },
  { value: 'inactive', label: 'Inactive', filter: (u) => !u.active },
];

export default function Equipment() {
  return (
    <SharedRecords
      collection="equipment"
      title="Trucks & Trailers"
      subtitle="Every truck and trailer from every connected app, joined by VIN or plate, with registration, inspection and insurance reminders."
      columns={COLUMNS}
      details={DETAILS}
      tabs={TABS}
      labelOf={labelOf}
      emptyText="No trucks or trailers yet. Connect an app on the Connections page and it will send its equipment here."
    />
  );
}
