/* ==========================================================
   Gemeinsame Konfiguration für alle Seiten dieser Website

   SUPABASE_URL / SUPABASE_KEY  Adresse und öffentlicher ("anon") Schlüssel der Datenbank.
                                Beide sind öffentlich gedacht – geschützt sind die Daten durch
                                Anmeldung und die Regeln in der Datenbank (supabase/schema.sql).
                                Den geheimen "service_role"-/"secret"-Schlüssel NIE hier eintragen.
   LOGIN_EMAIL_DOMAIN           Aus dem Nutzernamen "anna" wird intern die Adresse
                                "anna@<diese Domain>". Es werden nie E-Mails dorthin gesendet.

   Leer lassen (SUPABASE_URL = ''), dann läuft der Plan ohne Login nur lokal im Browser.
   ========================================================== */
window.SUPABASE_URL = 'https://dzikqeeubzieoxgzwdot.supabase.co';
window.SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6aWtxZWV1YnppZW94Z3p3ZG90Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQyOTk5NzcsImV4cCI6MjEwOTg3NTk3N30.kQpFA-VhjJZ4pjCRX7KmC4iwU1nRjbztjoYwEaKybFI';
window.LOGIN_EMAIL_DOMAIN = 'graftastisch.app';
