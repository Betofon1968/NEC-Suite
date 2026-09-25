# Putting the NEC Suite online

These steps use **Render** (render.com), like TMS. The file `render.yaml` in this repository sets up the web service and its PostgreSQL database in one go.

## Steps

1. **Pick a strong owner password.** At least 12 characters. It is the owner login; everyone else gets their own login on the Users page.
2. In Render, click **New**, then **Blueprint**, and choose this repository and the `main` branch.
3. Render shows the **nec-suite** web service and the **nec-suite-db** database. Choose a plan for each (paid plans for real use: free plans sleep and free databases are deleted after a trial period).
4. When asked for **SUITE_PASSWORD**, enter the password from step 1.
5. Click **Apply**. The first deploy takes a few minutes.
6. Open the address Render shows for **nec-suite** (for example `https://nec-suite.onrender.com`) and sign in with the email **owner** and your password.
7. Open **Apps** and fill in the web address of **TMS Truck** and the **TMS Driver app** (for example `https://tms-truck.onrender.com` and `https://tms-driver.onrender.com`). Check the other addresses.
8. Open **Users** and add a login for each person, choosing which apps they see.
9. Connect the apps, following [CONNECT.md](CONNECT.md). Start with TMS Truck.

## Your own web address (optional)

In Render, open **nec-suite**, go to **Settings**, then **Custom Domains**, and add for example `suite.yourcompany.com`. Render shows the DNS record to add at your domain provider. After it works, update `SUITE_URL` in every connected app.

## Changing the owner password

In Render, open **nec-suite**, go to **Environment**, change **SUITE_PASSWORD**, and save. The app restarts and the owner login is signed out everywhere. Other logins and app keys are not affected.

## Settings reference

| Setting | Meaning |
|---|---|
| `SUITE_PASSWORD` | Password of the owner login (email `owner`). Required online, at least 8 characters. |
| `DATABASE_URL` | PostgreSQL connection. Filled in by the Blueprint. |
| `DATABASE_SSL` | Set to `true` only if you connect to a database that requires SSL from outside Render. |
