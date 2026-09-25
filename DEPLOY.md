# Putting the NEC Suite online

The NEC Suite runs on **Render** (render.com) and keeps its data in **Supabase** (supabase.com), where Newman's Dashboard and NEC Trucking Compliance already keep theirs. Render runs the program; Supabase holds the database.

## Part 1: the database in Supabase

One new Supabase project holds the data of the NEC Suite **and** TMS Truck. Their tables have different names, so they never mix. Keep it separate from the Newman's and NEC Trucking projects: those have their own rules, and NEC Trucking holds private MVR records that must stay on their own.

1. In Supabase, click **New project**. Name it `nec-suite`, pick the region **East US (North Virginia)**, and let Supabase generate a **database password**. Save that password in your password manager: Supabase shows it only now.
2. Choose a paid plan for real use (free projects pause when they are not used for a while).
3. When the project is ready, click **Connect** at the top, open the **Session pooler** tab, and copy the connection string. It looks like `postgresql://postgres.abcd1234:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres`.
4. Replace `[YOUR-PASSWORD]` with the database password from step 1. This full line is your **DATABASE_URL**. Keep it private: anyone with it can read and change all the data.

Use the **Session pooler** string, not the Direct connection: Render cannot reach the direct address.

The NEC Suite creates its tables the first time it starts. It also locks them (Row Level Security, no public access), because Supabase otherwise serves every table through its web API to anyone with the project's public key. You do not need to run any SQL.

## Part 2: the app in Render

1. **Pick a strong owner password.** At least 12 characters. It is the owner login; everyone else gets their own login on the Users page.
2. In Render, click **New**, then **Blueprint**, and choose this repository and the `main` branch.
3. Render shows the **nec-suite** web service. Choose a paid plan for real use (free plans go to sleep when idle).
4. When asked for **SUITE_PASSWORD**, enter the password from step 1. When asked for **DATABASE_URL**, paste the line from Part 1.
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
| `DATABASE_URL` | The Supabase Session pooler connection string, with the database password in it. |
| `DATABASE_SSL` | Turned on automatically for Supabase. Set to `true` for another database that requires SSL. |

## Backups

Supabase backs up paid projects every day (**Database**, then **Backups**). If the shared drivers, trucks and trailers were ever lost, the connected apps send them all again within 10 minutes. Users, apps and connection keys come back only from a backup.
