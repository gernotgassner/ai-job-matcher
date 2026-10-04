# SkillMatcher (von JobSense AI)

Web-App mit Google-Login, lokalem CV-Upload, KI-gestütztem Job-Matching mit transparenter Begründung und dauerhaften Favoriten. Die Jobsuche ist auf die DACH-Region (Deutschland, Österreich, Schweiz) beschränkt.

## Datenschutz im Prototyp

Der Lebenslauf und die Favoriten werden ausschließlich im `localStorage` des verwendeten Browsers gespeichert. Bei jeder Jobsuche wird der Lebenslauftext direkt im Request an das Backend mitgeschickt (die Serverless-Functions auf Vercel haben keinen gemeinsamen Speicher zwischen Aufrufen/Routen). Mit „Lebenslauf löschen" wird der CV aus dieser lokalen Umgebung entfernt.

## KI-Matching

Ist die Umgebungsvariable `OPENAI_API_KEY` (bevorzugt, Modell per `OPENAI_MODEL` änderbar, Standard `gpt-4o-mini`) oder `ANTHROPIC_API_KEY` in Vercel gesetzt, bewertet die KI jede gefundene Stelle anhand von Lebenslauf, Wunschberuf und optionalem Kurzbeschrieb und liefert einen Match-Score sowie eine kurze Zusammenfassung, warum die Stelle passt. Ohne API-Key fällt die App auf einen einfachen Keyword-Abgleich ohne KI-Zusammenfassung zurück.

## Preismodell & Zugriff

Die Jobsuche selbst ist für alle unbegrenzt oft möglich (kein Freikontingent, keine Sperre). Das Abo (CHF 9.90/Monat, monatlich zum Periodenende kündbar, verlängert sich sonst automatisch über Stripe Checkout) steuert stattdessen die Ergebnistiefe:

- **Ohne Abo:** bis zu 3 Top-Matches (ab 85 % Match) pro Suche.
- **Mit Abo:** bis zu 10 Top-Matches (ab 85 %) plus bis zu 10 weitere Treffer im Bereich 50-84 %, ein hervorgehobener „Best Match", eine Wachstumsempfehlung je Job („was fehlt dir zu 100 %?") sowie bei erneutem Klick auf „Jobs durchsuchen" frische Ergebnisse (Cursor-Pagination statt derselben Seite).
- Erreicht keine Stelle mindestens 50 % Match, zeigt die App stattdessen eine KI-generierte Empfehlung, wie sich die Trefferquote verbessern lässt (Wunschberuf anpassen, Lebenslauf klarer strukturieren).

Der Abo-Status wird serverseitig live gegen Stripe geprüft (keine eigene Datenbank nötig für den Status selbst).

## Benötigte Umgebungsvariablen (Vercel Project Settings)

- `JWT_SECRET` – Signaturschlüssel für Login-Tokens
- `JSEARCH_API_KEY` – RapidAPI-Key für die JSearch-Jobsuche
- `OPENAI_API_KEY` – für KI-Matching & Zusammenfassung (optional, aber empfohlen)
- `ANTHROPIC_API_KEY` – alternativ zu OpenAI (wird nur genutzt, wenn kein OpenAI-Key gesetzt ist)
- `GOOGLE_CLIENT_ID` – für den echten Google-Login (optional, Testlogin funktioniert auch ohne)

## Deployment

Die App wird über Vercel deployed (statische Assets aus `public/` + Serverless-Functions aus `api/`).
