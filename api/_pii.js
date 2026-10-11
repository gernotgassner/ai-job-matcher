// Datensparsamkeit: entfernt eindeutig erkennbare Kontakt- und Stammdaten
// aus dem Lebenslauftext, BEVOR er an den KI-Anbieter geht. Das ist eine
// deterministische Ergänzung zur Prompt-Anweisung ("ignoriere persönliche
// Daten") - Namen und Firmennamen lassen sich per Regex nicht zuverlässig
// erkennen und bleiben deshalb weiterhin der KI-Anweisung überlassen.
const LABEL_LINE = /^\s*(geburtsdatum|geboren|geb\.|geburtsort|nationalit[aä]t|staatsangeh[oö]rigkeit|zivilstand|familienstand|adresse|anschrift|wohnort|telefon|tel\.?|mobil|handy|e-?mail|ahv|sozialversicherung|steuer|date of birth|birth|address|phone|nationality)\b/i;

export function redactPii(text) {
  let t = String(text);
  t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[E-Mail entfernt]');
  t = t.replace(/\b(?:https?:\/\/|www\.)[^\s<>")]+/gi, '[Link entfernt]');
  t = t.replace(/\b(?:linkedin|xing|github)\.com\/[^\s]*/gi, '[Link entfernt]');
  t = t.replace(/(?:\+|00)\d{1,3}[\s().-]*(?:\(0\)[\s.-]*)?\d(?:[\s().-]*\d){6,12}/g, '[Telefon entfernt]');
  t = t.replace(/\b0\d{1,3}[\s/.-]\d{2,4}(?:[\s.-]\d{2,4}){1,3}\b/g, '[Telefon entfernt]');
  t = t.replace(/\b[A-ZÄÖÜ][\wäöüß.-]*(?:strasse|straße|str\.|weg|gasse|platz|allee)\s*\d+[a-z]?\b/g, '[Adresse entfernt]');
  t = t.split('\n').filter((line) => !LABEL_LINE.test(line)).join('\n');
  return t;
}
