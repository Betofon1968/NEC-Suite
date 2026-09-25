# Connecting an app to the NEC Suite

Each app shares data through the suite's **hub API**. An app sends its own full list of drivers or trucks and trailers, and (if allowed) reads back the combined record, for example the qualification status from the compliance app.

## 1. Create the connection

In the suite, open **Connections**, click **Connect an app**, pick what the app may do, and click **Connect and show key**. Copy:

* `SUITE_URL`: the suite address, for example `https://nec-suite.onrender.com`
* `SUITE_API_KEY`: the key, which starts with `suite_`. It is shown once.

Put both in the app's **server** settings. Never put the key in a web page or a phone app, where anyone could read it. For apps on Supabase, that means an Edge Function secret:

```bash
npx supabase@latest secrets set SUITE_URL=https://nec-suite.onrender.com SUITE_API_KEY=suite_... --project-ref <ref>
```

## 2. Permissions

| Permission | Lets the app |
|---|---|
| `drivers:write` | Send its drivers |
| `qualification:write` | Send qualification status and review dates (give this only to NEC Trucking Compliance) |
| `drivers:read` | Read the combined drivers it also has |
| `equipment:write` | Send its trucks and trailers |
| `equipment:read` | Read the combined trucks and trailers it also has |

Suggested: **TMS Truck** and **Newman's Dashboard** get drivers and equipment, read and write. **NEC Trucking Compliance** gets `drivers:write` and `qualification:write` only.

## 3. API

Every call sends the key in the `Authorization` header:

```
Authorization: Bearer suite_...
```

| Call | What it does |
|---|---|
| `GET /api/hub/v1/me` | Checks the key. Returns the connection name and permissions. |
| `PUT /api/hub/v1/drivers` | Replaces all drivers this app sent before with `{ "drivers": [...] }`. |
| `PUT /api/hub/v1/equipment` | Replaces all trucks and trailers this app sent before with `{ "equipment": [...] }`. |
| `GET /api/hub/v1/drivers` | Combined drivers this app also has. Add `?all=1` for every driver. |
| `GET /api/hub/v1/equipment` | Combined trucks and trailers this app also has. Add `?all=1` for all. |

**Always send the full list.** A driver or unit missing from the list is removed from the suite, so a driver deleted in the app leaves the suite too. Sending the same list again changes nothing, so it is safe to send every few minutes. Up to 5,000 records per call.

Reads return an `ETag`. Send it back as `If-None-Match` and the suite answers `304 Not Modified` when nothing changed.

Wrong key: `401`. Missing permission: `403`. Bad data: `400` with `{ "error": "..." }`. Too many wrong keys from one address: `429` for 15 minutes.

### Driver fields

`externalId` (required, the app's own id) and a name (`name`, or `firstName` and `lastName`), plus any of:

| Field | Type |
|---|---|
| `firstName`, `lastName`, `name` | text |
| `phone` | any US phone format; the last 10 digits are kept |
| `email` | email |
| `status` | text, for example `Active` or `Inactive` |
| `driverType` | text, for example `Company driver` |
| `employeeId` | text |
| `cdlClass` | text |
| `endorsements` | list of letters, for example `["H","N"]` |
| `licenseState` | 2 letter state |
| `licenseExpiry`, `medicalExpiry`, `hireDate` | date `YYYY-MM-DD` |
| `truckUnit` | text |
| `qualificationStatus` | `qualified`, `conditional`, `pending_review`, or `disqualified` (needs `qualification:write`) |
| `lastReviewedOn`, `nextCheckOn` | date (needs `qualification:write`) |

**Never stored:** license numbers, birth dates, SSN, MVR or abstract details. The suite drops them and lists their names in `ignoredFields` in the answer, so a mistake is visible. Keep them in the app that owns them.

### Truck and trailer fields

`externalId` (required), `kind` (`truck` or `trailer`, required), and a `unit` number or `vin`, plus any of: `plate`, `plateState`, `plateExpiry`, `inspectionDue`, `insuranceName`, `insuranceExpiry`, `make`, `model`, `year`, `equipmentType`, `ownership`, `status`.

### Answer to a PUT

```json
{ "ok": true, "version": 42, "added": 1, "updated": 2, "unchanged": 30, "removed": 0, "ignoredFields": [], "invalidFields": [] }
```

`invalidFields` lists fields that were sent but could not be read (for example a date not in `YYYY-MM-DD`). They are left out; the rest of the record is kept.

### A combined driver, as read by an app

```json
{
  "id": "5c1f...",
  "yourId": "d1",
  "name": "Jose Rivera",
  "phone": "9735550101",
  "status": "Active",
  "medicalExpiry": "2027-07-02",
  "licenseExpiry": "2027-10-30",
  "qualification": { "status": "qualified", "label": "Qualified", "lastReviewedOn": "2026-07-27", "nextCheckOn": "2026-10-25", "app": "NEC Trucking Compliance" },
  "mismatches": [{ "field": "medicalExpiry", "label": "Medical card", "values": [{ "app": "TMS Truck", "value": "Jul 22, 2027" }, { "app": "NEC Trucking Compliance", "value": "Jul 2, 2027" }] }],
  "alerts": [{ "level": "amber", "field": "medicalExpiry", "text": "Apps disagree on medical card" }],
  "apps": ["TMS Truck", "NEC Trucking Compliance"]
}
```

`yourId` is this app's own id for the driver, so it can find the driver in its records.

## 4. How the same driver or unit is recognized

When an app sends a record the suite has not seen before, it looks for the same driver or unit sent by another app:

* **Drivers:** same phone number, then same employee id, then same full name (ignoring case, accents and punctuation).
* **Trucks and trailers:** same VIN, then same plate and state.

A match counts only when exactly one existing driver or unit fits, and never joins two records from the same app. Anything it misses or joins by mistake can be fixed on the Drivers or Trucks & Trailers page (admins only).

## 5. Apps

### TMS Truck

Built in. In Render, open **tms-truck**, go to **Environment**, add `SUITE_URL` and `SUITE_API_KEY`, and save. TMS then sends its drivers, trucks and trailers after every change and every 10 minutes, shows each driver's qualification from NEC Trucking Compliance on its Drivers page, and adds an **All apps** link back to the suite in its menu.

### NEC Trucking Compliance (Supabase)

A scheduled Edge Function reads the qualification projection (the same columns as `mvr.drivers_restricted`: no license numbers, birth dates, events or documents) and sends it:

```js
// supabase/functions/suite_sync/index.ts (outline)
const drivers = rows.map((r) => ({
  externalId: r.driver_id,
  name: r.full_name,
  employeeId: r.employee_id,
  status: r.employment_status,
  licenseState: r.license_state,
  cdlClass: r.license_class,
  licenseExpiry: r.license_expires_on,
  medicalExpiry: r.medical_cert_expires_on,
  // inactive drivers are sent with status only
  qualificationStatus: r.qualification_status === 'inactive' ? undefined : r.qualification_status,
  lastReviewedOn: r.last_reviewed_on,
  nextCheckOn: r.next_check_on,
}));
await fetch(`${Deno.env.get('SUITE_URL')}/api/hub/v1/drivers`, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${Deno.env.get('SUITE_API_KEY')}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ drivers }),
});
```

Run it with `pg_cron` every 15 minutes, and write an audit log row for each run, as the module requires for background reads.

### Newman's Dashboard (Supabase)

A scheduled Edge Function reads the drivers and trucks directories from `logistics_config` and sends them with `PUT /api/hub/v1/drivers` and `PUT /api/hub/v1/equipment` (`kind: "truck"`, `unit` from the truck number). Driver license numbers in that directory are not sent.
