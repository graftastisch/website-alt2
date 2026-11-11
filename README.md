# Wochenplan mit Login

Statische Website für GitHub Pages (`https://graftastisch.github.io/website/`).
Die Startseite leitet auf `/plan/` weiter, und davor sitzt ein Login unter `/login/`.

## Aufbau

```
index.html            → leitet auf plan/ weiter
assets/config.js      → Supabase-URL, öffentlicher Schlüssel, Domain für Nutzernamen
assets/auth.js        → gemeinsames Login-Modul für alle Seiten
login/                → Anmeldeseite (+ Konto: Passwort ändern, Abmelden)
plan/                 → der Wochenplan (geschützt)
supabase/schema.sql   → Datenbankschema (für ein neues Projekt)
supabase/add-user.sql → neuen Nutzer freigeben
```

## Wie das Login funktioniert

- Anmeldung mit **Nutzername + Passwort** über Supabase Auth. Intern wird der Name zu `<name>@graftastisch.app`.
- Wer `/plan/` ohne Sitzung öffnet, landet bei `/login/` und kommt nach der Anmeldung zurück.
- Die Sitzung liegt im `localStorage` und gilt für **alle Seiten** der Website.
- Eine weitere Seite schützt man mit drei Zeilen im `<head>`:

```html
<script src="../assets/config.js"></script>
<script src="../assets/auth.js"></script>
<script>Auth.guard('../login/');</script>
```

Ihre Daten sichert man in Supabase mit `public.is_member()` ab (siehe `schema.sql`).

## Neuen Nutzer anlegen

1. Supabase-Dashboard → Authentication → Users → Add user → Create new user.
   E-Mail `<nutzername>@graftastisch.app`, Passwort wählen, **Auto Confirm User** an.
2. Nutzer freigeben: `supabase/add-user.sql` mit dem Namen im SQL-Editor ausführen.
   Ohne Freigabe sieht das Konto keine Daten.

Das Passwort ändert man später selbst unter `/login/`.

## Sicherheit

- Tabellen und der Speicher (`plan-media`, privat) sind nur für angemeldete **und freigegebene** Konten zugänglich. Bilder werden über zeitlich begrenzte, signierte Links geladen.
- Der Schlüssel in `assets/config.js` ist der öffentliche `anon`-Schlüssel. Der `service_role`-Schlüssel gehört nie in die Website.
- Empfehlung: im Dashboard unter Authentication → Sign In / Providers **«Allow new users to sign up»** ausschalten.
- Auf `github.io` teilen sich alle Projekte desselben Kontos den `localStorage`-Ursprung. Der Schlüssel `graftastisch-session` ist deshalb nur für diese Website gedacht.
- Free-Tier: Supabase pausiert das Projekt nach 7 Tagen ohne Aktivität (im Dashboard wieder aktivierbar). Dateien sind auf 50 MB begrenzt.

## Ohne Supabase

Sind URL und Schlüssel in `assets/config.js` leer, läuft der Plan nur lokal im Browser, ohne Login und ohne Sync.
