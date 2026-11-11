-- ============================================================================
-- Neuen Nutzer für das Login anlegen
--
-- 1. Supabase-Dashboard → Authentication → Users → "Add user" → "Create new user"
--      E-Mail:   <nutzername>@graftastisch.app     (Domain = LOGIN_EMAIL_DOMAIN in assets/config.js)
--      Passwort: frei wählen (lässt sich später auf der Seite /login ändern)
--      "Auto Confirm User" einschalten
--    Beim Login gibt man nur den Nutzernamen ein (der Teil vor dem @).
--
-- 2. Nutzer freigeben: unten den Nutzernamen eintragen und im SQL-Editor ausführen.
--    Ohne diese Freigabe kann sich das Konto zwar anmelden, sieht aber keine Daten.
-- ============================================================================

insert into public.members (user_id)
select id from auth.users where email = 'NUTZERNAME@graftastisch.app'
on conflict do nothing;

-- Freigabe wieder entziehen:
-- delete from public.members where user_id = (select id from auth.users where email = 'NUTZERNAME@graftastisch.app');
