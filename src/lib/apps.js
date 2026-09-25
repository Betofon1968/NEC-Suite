// The apps shown on the suite home screen when it starts for the first time. An admin
// can change addresses, add or remove apps on the Apps page.
export const DEFAULT_APPS = [
  {
    name: 'TMS Truck',
    description: 'Loads, dispatch board, invoices and driver settlements',
    url: '',
    icon: '🚚',
    color: 'blue',
  },
  {
    name: 'TMS Driver app',
    description: 'Phone app for drivers: stops, check calls, BOL and POD photos',
    url: '',
    icon: '📱',
    color: 'teal',
  },
  {
    name: "Newman's Dashboard",
    description: 'Routes, pallets, BOLs, manifests and invoices',
    url: 'https://pbnewmans.com',
    icon: '🥖',
    color: 'amber',
  },
  {
    name: "Newman's Manager Mobile",
    description: 'Loadboard, stores and drivers on the phone',
    url: 'https://pbnewmans.com/iPhone/',
    icon: '📲',
    color: 'amber',
  },
  {
    name: 'NEC Trucking Compliance',
    description: 'Driver MVR monitoring and 49 CFR 391.25 reviews',
    url: 'https://app.nectrucking.com',
    icon: '🛡',
    color: 'indigo',
  },
  {
    name: 'Porky Local Management',
    description: 'Porky Products local operations and weekly owner operator settlements',
    url: '',
    icon: '🐖',
    color: 'red',
  },
];

export const APP_COLORS = ['blue', 'teal', 'green', 'amber', 'red', 'indigo', 'slate'];

// Only web addresses can be opened from the home screen (never javascript: or data: links).
export function cleanUrl(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
}
