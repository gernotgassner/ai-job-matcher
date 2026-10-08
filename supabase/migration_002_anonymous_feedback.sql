-- Migration: Feedback vollständig anonymisieren.
-- Einmalig im Supabase SQL-Editor ausführen. Löscht auch alle bisher
-- gespeicherten E-Mail-Adressen aus bereits vorhandenen Feedback-Einträgen
-- (der Text/Inhalt des Feedbacks bleibt erhalten).

alter table feedback drop column if exists email;
