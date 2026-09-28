# AI Job Matcher

Prototyp mit Testlogin (bzw. Google-Login), lokalem CV-Upload, KI-gestütztem Job-Matching mit Zusammenfassung und dauerhaften Favoriten. Die Jobsuche ist auf die DACH-Region (Deutschland, Österreich, Schweiz) beschränkt.

## Datenschutz im Prototyp

Der Lebenslauf und die Favoriten werden ausschließlich im `localStorage` des verwendeten Browsers gespeichert. Bei jeder Jobsuche wird der Lebenslauftext direkt im Request an das Backend mitgeschickt (die Serverless-Functions auf Vercel haben keinen gemeinsamen Speicher zwischen Aufrufen/Routen). Mit „Lebenslauf löschen" wird der CV aus dieser lokalen Umgebung entfernt.

## KI-Matching

Ist die Umgebungsvariable `OPENAI_API_KEY` (bevorzugt, Modell per `OPENAI_MODEL` änderbar, Standard `gpt-4o-mini`) oder `ANTHROPIC_API_KEY` in Vercel gesetzt, bewertet die KI jede gefundene Stelle anhand von Lebenslauf, Wunschberuf und optionalem Kurzbeschrieb und liefert einen Match-Score sowie eine kurze Zusammenfassung, warum die Stelle passt. Ohne API-Key fällt die App auf einen einfachen Keyword-Abgleich ohne KI-Zusammenfassung zurück.

## Benötigte Umgebungsvariablen (Vercel Project Settings)

- `JWT_SECRET` – Signaturschlüssel für Login-Tokens
- `JSEARCH_API_KEY` – RapidAPI-Key für die JSearch-Jobsuche
- `OPENAI_API_KEY` – für KI-Matching & Zusammenfassung (optional, aber empfohlen)
- `ANTHROPIC_API_KEY` – alternativ zu OpenAI (wird nur genutzt, wenn kein OpenAI-Key gesetzt ist)
- `GOOGLE_CLIENT_ID` – für den echten Google-Login (optional, Testlogin funktioniert auch ohne)

## Deployment

Die App wird über Vercel deployed (statische Assets aus `public/` + Serverless-Functions aus `api/`).
