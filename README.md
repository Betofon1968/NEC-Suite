# NEC Suite

One home screen for every company app, and a data hub so the apps share drivers, trucks and trailers. Built with React 19, JavaScript, Vite and a small Node.js server, the same way as **TMS**.

## What it does

* **Home screen:** a tile for each app (TMS Truck, TMS Driver app, Newman's Dashboard, Newman's Manager Mobile, NEC Trucking Compliance, Porky Local Management, and any app you add). Each app opens in its own tab; clicking it again brings you back to that tab. The apps block being shown inside another website to protect their logins, so the suite links to them instead of embedding them.
* **One suite login:** each person signs in once to the suite and sees only the apps an admin gave them. Each app still has its own login and decides what the person can do inside it.
* **Drivers:** every driver from every connected app in one list. The suite recognizes the same person in different apps by phone number, employee id, or exact name (only when exactly one driver fits), and an admin can join or separate records by hand. It shows the qualification status sent by the compliance app, medical card and CDL dates, and where the apps disagree.
* **Trucks & Trailers:** every unit from every connected app, joined by VIN, or plate and state, with registration, annual inspection and insurance reminders.
* **Needs attention:** expired or soon to expire (30 days) medical cards, CDLs, registrations, inspections and insurance, drivers not qualified or due for review, and data the apps disagree on.
* **Connections:** each app that shares data gets its own key and only the permissions it needs (send drivers, send qualification, read drivers, send equipment, read equipment). Keys are shown once and stored only as a hash. A key can be replaced or turned off at any time.
* **Privacy:** license numbers, birth dates, and MVR details are never stored in the suite, even if an app sends them by mistake. Only the compliance app may send qualification status.
* **Users:** Admin or Staff role, and which apps each staff person sees. The owner account signs in with the email `owner` and `SUITE_PASSWORD`.

All times are shown in New York time (ET).

## Getting started

```bash
npm install
npm run dev       # server + suite at http://localhost:5175
npm test          # hub rules and server tests (set TEST_DATABASE_URL to also test PostgreSQL)
npm run build     # production build in dist/
npm start         # production server (serves dist/ and the API on port 3002)
```

Locally, sign in with the email `owner` and the password `suite123` unless you set `SUITE_PASSWORD`. Data is kept in the `data/` folder. TMS runs locally on port 5173 and its driver app on 5174, so the suite uses 5175 (and 3002 for its server).

To put it online, follow [DEPLOY.md](DEPLOY.md). To connect an app, follow [CONNECT.md](CONNECT.md).

## Project layout

```
server/
  app.js            API: suite users, apps, connections, and the hub for connected apps
  auth.js           password hashing, session tokens, sign in limits
  store/pg.js       PostgreSQL storage (online, in Supabase)
  store/file.js     local folder storage (your own computer)
src/
  lib/hub.js        the hub rules: cleaning what apps send, matching, merging, alerts
  lib/apps.js       the apps on the home screen at first start
  store/            data from the server, sign in, messages
  components/       layout and shared UI
  pages/            one file per screen
```

The hub rules in `src/lib/hub.js` are pure functions covered by `src/lib/hub.test.js`; the server is covered by `server/app.test.js`.

## Next steps

* Connect **NEC Trucking Compliance** with a Supabase Edge Function that sends each driver's qualification (see CONNECT.md).
* Connect **Newman's Dashboard** with a Supabase Edge Function that sends its drivers and trucks.
* Single sign on, so signing in to the suite also signs you in to each app.
* More shared data: customers and stores, and a money summary across apps.
