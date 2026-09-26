# AI Job Matcher

Statischer GitHub-Pages-Prototyp mit Testlogin, lokalem CV-Upload, Match-Schwelle von 90 Prozent und dauerhaften Favoriten.

## Datenschutz im Prototyp

Der Lebenslauf und die Favoriten werden ausschließlich im `localStorage` des verwendeten Browsers gespeichert. Mit „Lebenslauf löschen" wird der CV aus dieser lokalen Umgebung entfernt. Der Login ist nur ein Testlogin und keine echte Authentifizierung.

## GitHub Pages

In den Repository-Einstellungen unter **Pages** als Quelle **GitHub Actions** auswählen. Der Workflow veröffentlicht die statische App bei jedem Push auf `main`.

Die Demo verwendet lokale Beispielangebote. Eine echte Google-Anmeldung, echte freie Websuche und KI-Verarbeitung benötigen aus Sicherheitsgründen ein Backend; API-Schlüssel dürfen nicht in GitHub-Pages-JavaScript eingebaut werden.
