# SkillMatcher (von JobSense AI)

Web-App mit Google-Login, lokalem CV-Upload, KI-gestütztem Job-Matching mit transparenter Begründung und dauerhaften Favoriten. Die Jobsuche ist auf die DACH-Region (Deutschland, Österreich, Schweiz) beschränkt.

## Datenschutz im Prototyp

Der Lebenslauf und die Favoriten werden ausschließlich im `localStorage` des verwendeten Browsers gespeichert. Bei jeder Jobsuche wird der Lebenslauftext direkt im Request an das Backend mitgeschickt (die Serverless-Functions auf Vercel haben keinen gemeinsamen Speicher zwischen Aufrufen/Routen). Mit „Lebenslauf löschen" wird der CV aus dieser lokalen Umgebung entfernt.

## KI-Matching

Ist die Umgebungsvariable `OPENAI_API_KEY` (bevorzugt, Modell per `OPENAI_MODEL` änderbar, Standard `gpt-4o-mini`) oder `ANTHROPIC_API_KEY` in Vercel gesetzt, bewertet die KI jede gefundene Stelle anhand von Lebenslauf, Wunschberuf und optionalem Kurzbeschrieb und liefert einen Match-Score sowie eine kurze Zusammenfassung, warum die Stelle passt. Ohne API-Key fällt die App auf einen einfachen Keyword-Abgleich ohne KI-Zusammenfassung zurück.

## Preismodell & Zugriff

Jeder eingeloggte Nutzer hat 1 kostenlose Jobsuche pro Kalendermonat. Ab der 2. Suche ist ein Abo (CHF 9.90/Monat, monatlich zum Periodenende kündbar, verlängert sich sonst automatisch) über Stripe Checkout nötig. Abo-Status und Freikontingent werden serverseitig live gegen Stripe geprüft (Kunden-Metadata, keine eigene Datenbank) - ein Client-seitiger Reset (z. B. localStorage löschen) hat keinen Einfluss darauf. Verwaltung/Kündigung läuft über das Stripe-Kundenportal.

## Match-Bewertung

Der Lebenslauf (PDF, DOCX oder TXT) wird im Browser in Text umgewandelt. Die KI analysiert ihn und bewertet jede Stelle in vier Kriterien: fachliche Skills, Erfahrung, Passung zum Wunschberuf und Passung zum Kurzbeschrieb (Gewichtung 35/25/20/20 %, ohne Kurzbeschrieb 40/30/30 %). Die Prozentzahl wird aus diesen Teilwerten berechnet und im UI erklärt. Treffer unter 90 % werden nur auf Klick angezeigt.

## Benötigte Umgebungsvariablen (Vercel Project Settings)

- `JWT_SECRET` – Signaturschlüssel für Login-Tokens
- `JSEARCH_API_KEY` – RapidAPI-Key für die JSearch-Jobsuche
- `OPENAI_API_KEY` – für KI-Matching & Zusammenfassung (optional, aber empfohlen)
- `ANTHROPIC_API_KEY` – alternativ zu OpenAI (wird nur genutzt, wenn kein OpenAI-Key gesetzt ist)
- `GOOGLE_CLIENT_ID` – für den echten Google-Login (optional, Testlogin funktioniert auch ohne)

## Deployment

Die App wird über Vercel deployed (statische Assets aus `public/` + Serverless-Functions aus `api/`).
