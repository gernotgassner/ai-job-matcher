# Sicherheits- und Betriebs-Checkliste

Stand: Oktober 2026. Punkte mit ☐ sind **manuelle Einstellungen** in den jeweiligen Dashboards, die sich nicht aus dem Code
heraus setzen lassen. Punkte mit ✅ sind im Code bereits umgesetzt.

## 0. Sofort prüfen (Reihenfolge wichtig)

- ☐ **Vercel → Settings → Environment Variables:** `JWT_SECRET` ist gesetzt (Production), zufällig und **mindestens 32 Zeichen**
  (z. B. `openssl rand -hex 48`). Ohne gültiges Secret ist der Login absichtlich deaktiviert (fail closed).
  Früher gab es ein im öffentlichen Code stehendes Ersatz-Secret: Wenn `JWT_SECRET` damals **nicht** gesetzt war, konnten Dritte Admin-Tokens
  fälschen. In dem Fall: neues Secret setzen, `admin_users` (Supabase) sowie Stripe-Kunden/Abos auf unbekannte Einträge prüfen und
  vorsorglich Supabase-Service-Role-Key und Stripe-Key rotieren.
- ☐ `GOOGLE_CLIENT_ID` ist gesetzt und identisch mit der Client-ID in `public/app.js` (sonst Login deaktiviert, fail closed).
- ☐ Supabase SQL-Editor: `supabase/migration_002_anonymous_feedback.sql` und `supabase/migration_003_rate_limit.sql` ausgeführt.
- ☐ Alle jemals im Chat/Ticket/Mail geteilten Zugangsdaten (GitHub-Tokens, API-Keys) widerrufen bzw. rotieren.
  Künftig nur kurzlebige, auf das eine Repository begrenzte Fine-grained-Tokens verwenden und nie in Chats einfügen.

## 1. Code (✅ umgesetzt)

- ✅ Kein Fallback-Secret mehr; JWT nur HS256, Laufzeit 72 h; Google-ID-Token wird **mit Audience-Prüfung** verifiziert, Login fail-closed.
- ✅ Rate-Limits (Supabase-Zähler): Suche (20/Std., 100/Tag je Nutzer; per Env `SEARCH_LIMIT_PER_HOUR/DAY` änderbar), Login je IP,
  Feedback/Störungen, Cache-Umgehung beim Abo-Status.
- ✅ Eingabevalidierung (Typen, Größen: CV max. 60.000 Zeichen), nur POST auf Schreib-/Suchendpunkten, generische Fehlertexte für Nicht-Admins.
- ✅ Keine Wildcard-CORS-Header mehr (Frontend und API liegen auf derselben Origin).
- ✅ XSS-Härtung: Links nur http(s), keine Inline-Handler mit Fremddaten, vollständiges HTML-Escaping.
- ✅ Datensparsamkeit: E-Mail-Adressen, Telefonnummern, Links, Adressen und Geburtsdaten-Zeilen werden **vor** dem KI-Aufruf entfernt
  (Namen/Arbeitgeber nur per KI-Anweisung - technisch nicht zuverlässig erkennbar).
- ✅ Abmelden löscht den lokal gespeicherten Lebenslauf; Favoriten sind pro Nutzer getrennt.
- ✅ Alle Bibliotheken und Schriften werden selbst gehostet (keine CDN-/Google-Fonts-Abrufe, weniger Supply-Chain-Risiko, DSGVO-freundlicher).
- ✅ Sicherheits-Header (HSTS, nosniff, Frame-Schutz, Referrer-/Permissions-Policy, COOP) und Content-Security-Policy:
  ein Basis-Set ist aktiv, die **strenge Policy läuft zunächst als `Content-Security-Policy-Report-Only`**.
  ☐ Im Browser (F12 → Konsole) Login, CV-Upload, Suche, Abo-Dialog und `/admin.html` einmal durchspielen. Erscheinen keine
  „[Report Only] Refused to …"-Meldungen, den Header in `vercel.json` von `Content-Security-Policy-Report-Only` auf `Content-Security-Policy`
  umstellen (Inhalt zusammenführen).
- ✅ Lockfile (`package-lock.json`) + `npm ci` für reproduzierbare Builds, Node 22 fixiert, ungenutzte Pakete entfernt, `npm audit`: 0 Lücken,
  Dependabot-Updates aktiv.

## 2. GitHub

- ☐ 2-Faktor-Authentifizierung für den Account (Passkey/Authenticator), Sitzungen/SSH-Keys/Tokens aufräumen.
- ☐ Repository → Settings → Code security: **Dependabot alerts + security updates** aktivieren; **Secret scanning + Push protection** (für
  öffentliche Repos kostenlos); **Code scanning (CodeQL, „default setup")** aktivieren.
- ☐ Branch protection für `main`: Pull Request verpflichtend, Force-Push und Löschen verbieten, Status-Checks verlangen.
- ☐ Entscheiden, ob das Repo öffentlich bleibt: Öffentlich = kostenlose Scanning-Funktionen, aber Architektur/Admin-Adresse sichtbar.
  Privat = weniger Angriffsfläche, aber einige Scanning-Features sind dann kostenpflichtig. Wichtig in beiden Fällen: **nie Secrets committen**
  (Git-Historie wurde geprüft: keine Funde).

## 3. Vercel

- ☐ 2FA auf dem Vercel-Account; Team-Mitglieder minimal halten.
- ☐ Secrets nur für **Production** setzen; Variablen als „Sensitive" markieren (danach nicht mehr auslesbar).
- ☐ Deployment Protection für Preview-Deployments aktivieren (sonst sind Vorschau-URLs öffentlich erreichbar).
- ☐ Vercel Firewall (WAF): Rate-Limit-Regel für `/api/*` und „Bot Protection" aktivieren (Verfügbarkeit/Kontingent je Plan in den Vercel-Docs prüfen).
  Das ist eine zweite Verteidigungslinie vor unserem Code-Rate-Limit.
- ☐ **Plan prüfen:** Der Hobby-Plan ist laut Vercels Fair-Use-Richtlinien für nicht-kommerzielle Nutzung vorgesehen. Ein bezahltes Abo-Produkt
  ist kommerziell - vor dem Livegang auf Pro wechseln (bringt außerdem Spend-Limits und höhere Kontingente).
- ☐ Eigene Domain + HTTPS (HSTS ist gesetzt), danach `APP_URL`, Google-OAuth-Origin und Stripe-Rücksprung-URLs anpassen.
- ☐ Observability/Alerts für Fehlerraten und Laufzeiten einrichten.

## 4. Supabase

- ☐ 2FA/MFA für das Supabase-Konto.
- ✅ RLS auf allen Tabellen aktiv, ohne Policies (anon/authenticated haben keinen Zugriff); Migration 003 entzieht zusätzlich die Tabellenrechte.
- ☐ Service-Role-Key **nur** in Vercel (Server) - nie im Frontend, nie im Chat. Bei Verdacht: Key rotieren.
- ☐ Backups: Umfang des Plans prüfen (der kostenlose Plan bietet nach meinem Kenntnisstand keine automatischen täglichen Backups); ggf. Pro-Plan
  oder regelmäßiger Export.
- ☐ Projekt-Einstellungen: SSL erzwingen, nicht benötigte Erweiterungen/Schemas der Data API nicht freigeben.

## 5. Google, Stripe, Anthropic

- ☐ Google Cloud Console: OAuth-Zustimmungsbildschirm vollständig, nur die tatsächlich genutzten JavaScript-Origins eintragen, Projekt mit 2FA absichern.
- ☐ Stripe: für den Server einen **eingeschränkten API-Key** (Restricted Key) mit nur den nötigen Rechten (Customers, Subscriptions, Checkout, Billing Portal) statt
  des vollen Secret Keys verwenden; 2FA aktiv; Radar/Betrugsschutz prüfen.
- ☐ Anthropic Console: **Monatliches Ausgabenlimit** setzen, Rate-Limits/Tier unter *Settings → Limits* prüfen und ggf. durch Guthaben-Aufladung anheben;
  Auftragsverarbeitungsvertrag (DPA) und Aufbewahrungsfristen prüfen und in der Datenschutzerklärung korrekt wiedergeben.
- ☐ RapidAPI (JSearch): Kontingent des gebuchten Plans prüfen - er ist bei vielen Nutzern meist der erste Engpass; Alerts bei 80 % Verbrauch einrichten.

## 6. Skalierung und Laufzeit (Hintergrund)

- Vercel skaliert Funktionen automatisch (auch im Hobby-Plan); das Limit liegt bei den **Drittanbietern** (Anthropic, JSearch, Stripe).
- ✅ Gegenmaßnahmen im Code: Cache für Abo-Status und Admin-Prüfung (60 s), Cache für Jobbörsen-Ergebnisse (10 min), Wiederholungsversuch bei 429/5xx der KI,
  Zeitbudget (die KI bekommt nur die verbleibende Zeit; bei Überschreitung folgt die Keyword-Näherung statt eines Timeouts), Funktionslaufzeit 60 s,
  Client-Timeout 70 s.
- ☐ Last testen: mit k6/Artillery gegen eine **Preview-Deployment** und nur gegen die günstigen Endpunkte (`/api/subscription-status`, Login nicht).
  Die Suche nicht mit echten Keys lasttesten (echte KI-/Jobbörsen-Kosten).
