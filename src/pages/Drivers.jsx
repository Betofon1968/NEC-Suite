import { SharedRecords, Expiry, needsAttention } from '../components/Shared.jsx';
import { Badge } from '../components/ui.jsx';
import { date, dateTime, formatPhone } from '../lib/format.js';

const labelOf = (d) => d.name || 'Unnamed driver';

const Qualification = ({ q }) => (q ? <Badge>{q.label}</Badge> : <span className="muted small">Not sent</span>);

const COLUMNS = [
  { header: 'Driver', render: (d) => <strong className="nowrap">{labelOf(d)}</strong> },
  { header: 'Phone', render: (d) => <span className="nowrap">{formatPhone(d.phone)}</span> },
  { header: 'Qualification', render: (d) => <Qualification q={d.qualification} /> },
  { header: 'Medical card', render: (d) => <Expiry value={d.medicalExpiry} /> },
  { header: 'CDL expires', render: (d) => <Expiry value={d.licenseExpiry} /> },
];

const DETAILS = [
  ['Status', (d) => <Badge>{d.status}</Badge>],
  ['Phone', (d) => formatPhone(d.phone)],
  ['Email', (d) => d.email],
  ['Driver type', (d) => d.driverType],
  ['CDL', (d) => [d.cdlClass && `Class ${d.cdlClass}`, d.licenseState].filter(Boolean).join(', ')],
  ['CDL expires', (d) => d.licenseExpiry && <Expiry value={d.licenseExpiry} />],
  ['Medical card', (d) => d.medicalExpiry && <Expiry value={d.medicalExpiry} />],
  ['Truck', (d) => d.truckUnit],
  [
    'Qualification',
    (d) =>
      d.qualification && (
        <>
          <Badge>{d.qualification.label}</Badge>{' '}
          <span className="small muted">
            from {d.qualification.app}
            {d.qualification.lastReviewedOn && `, last review ${date(d.qualification.lastReviewedOn)}`}
            {d.qualification.nextCheckOn && `, next check ${date(d.qualification.nextCheckOn)}`}, sent {dateTime(d.qualification.updatedAt)}
          </span>
        </>
      ),
  ],
];

const TABS = [
  { value: 'active', label: 'Active', filter: (d) => d.active },
  { value: 'attention', label: 'Needs attention', filter: needsAttention },
  { value: 'inactive', label: 'Inactive', filter: (d) => !d.active },
  { value: 'all', label: 'All', filter: () => true },
];

export default function Drivers() {
  return (
    <SharedRecords
      collection="drivers"
      title="Drivers"
      subtitle="Every driver from every connected app, joined into one list. License numbers, birth dates and MVR details stay in the app that owns them."
      columns={COLUMNS}
      details={DETAILS}
      tabs={TABS}
      labelOf={labelOf}
      emptyText="No drivers yet. Connect an app on the Connections page and it will send its drivers here."
    />
  );
}
