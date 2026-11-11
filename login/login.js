'use strict';
(() => {
  const $ = s => document.querySelector(s);
  const loginView = $('#loginView'), accountView = $('#accountView'), fatal = $('#fatal');

  // Nur Pfade innerhalb dieser Website zulassen (keine Weiterleitung auf fremde Adressen)
  function safeNext() {
    const n = new URLSearchParams(location.search).get('next') || '';
    return /^\/(?![/\\])/.test(n) && !n.startsWith(location.pathname) ? n : '';
  }

  function show(el, text, kind) {
    el.textContent = text;
    el.className = 'msg' + (kind ? ' ' + kind : '');
    el.hidden = !text;
  }

  function explain(e) {
    switch (e.code) {
      case 'invalid_credentials': case 'invalid_grant': return 'Nutzername oder Passwort falsch.';
      case 'empty_username': return 'Bitte Nutzernamen eingeben.';
      case 'empty_password': return 'Bitte Passwort eingeben.';
      case 'invalid_username': return 'Der Nutzername darf nur Buchstaben, Zahlen, Punkt, Bindestrich und Unterstrich enthalten.';
      case 'network': return 'Keine Verbindung zum Server.';
      case 'email_not_confirmed': return 'Dieses Konto ist noch nicht freigeschaltet.';
      case 'over_request_rate_limit': case 'over_email_send_rate_limit': return 'Zu viele Versuche – bitte einen Moment warten.';
      case 'same_password': return 'Das neue Passwort muss sich vom alten unterscheiden.';
      case 'weak_password': return 'Das Passwort ist zu schwach – bitte ein längeres wählen.';
      default: return e.status === 429 ? 'Zu viele Versuche – bitte einen Moment warten.' : (e.message || 'Unbekannter Fehler.');
    }
  }

  function showAccount() {
    $('#name').textContent = Auth.username();
    loginView.hidden = true;
    accountView.hidden = false;
  }
  function showLogin() {
    accountView.hidden = true;
    loginView.hidden = false;
    $('#user').focus();
  }

  if (!Auth.enabled) {
    fatal.textContent = 'Das Login ist nicht eingerichtet (assets/config.js ist leer).';
    fatal.hidden = false;
    return;
  }

  // Schon angemeldet? Mit Ziel direkt weiter, sonst Konto-Ansicht
  if (Auth.session()) {
    const next = safeNext();
    if (next) location.replace(next); else showAccount();
  } else {
    showLogin();
  }

  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('#loginMsg'), btn = $('#loginBtn');
    show(msg, '');
    btn.disabled = true; btn.textContent = 'Anmelden …';
    try {
      await Auth.login($('#user').value, $('#pass').value);
      location.replace(safeNext() || '../plan/');
    } catch (err) {
      show(msg, explain(err));
      $('#pass').value = '';
      $('#pass').focus();
      btn.disabled = false; btn.textContent = 'Anmelden';
    }
  });

  $('#pwForm').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('#pwMsg'), btn = $('#pwBtn');
    const a = $('#pw1').value, b = $('#pw2').value;
    if (a.length < 8) return show(msg, 'Das Passwort braucht mindestens 8 Zeichen.', 'err');
    if (a !== b) return show(msg, 'Die beiden Passwörter stimmen nicht überein.', 'err');
    btn.disabled = true;
    try {
      await Auth.changePassword(a);
      $('#pw1').value = ''; $('#pw2').value = '';
      show(msg, 'Passwort geändert ✓', 'ok');
    } catch (err) {
      show(msg, explain(err), 'err');
    } finally { btn.disabled = false; }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    await Auth.logout();
    // Zwischengespeicherte Plan-Daten dieses Geräts entfernen
    try { indexedDB.deleteDatabase('wochenplan'); } catch { /* ignorieren */ }
    $('#user').value = ''; $('#pass').value = '';
    showLogin();
  });
})();
