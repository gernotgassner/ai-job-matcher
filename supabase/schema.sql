-- SkillMatcher / JobSense AI - Admin-Bereich Schema
-- Einmalig im Supabase SQL-Editor ausführen (Dashboard -> SQL Editor -> New query -> einfügen -> Run).
-- Sicher erneut ausführbar (IF NOT EXISTS), falls du es mehrfach laufen lässt.

create extension if not exists pgcrypto;

-- Kundenfeedback über den "Feedback geben"-Button im Profil.
-- Enthält bewusst die E-Mail, damit bei Bedarf nachgefragt werden kann.
create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  text text not null,
  page text,
  created_at timestamptz not null default now()
);
create index if not exists feedback_created_at_idx on feedback (created_at desc);

-- Störungsmeldungen über den "Störung melden"-Button im Profil.
create table if not exists issue_reports (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  text text not null,
  page text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists issue_reports_created_at_idx on issue_reports (created_at desc);

-- Technisches Fehlerprotokoll (JSearch-/KI-Fehler etc.) - ABSICHTLICH OHNE
-- Spalte für die E-Mail/den Nutzer, damit im Admin-Bereich keine Zuordnung
-- zu einer Person möglich ist.
create table if not exists error_logs (
  id uuid primary key default gen_random_uuid(),
  error_type text not null,
  message text not null,
  created_at timestamptz not null default now()
);
create index if not exists error_logs_created_at_idx on error_logs (created_at desc);

-- Zusätzliche Admins (Superuser). gernot.gassner@gmail.com ist fest im Code
-- hinterlegt und braucht keinen Eintrag hier. Ein neuer Admin wird zunächst
-- mit status='pending' eingetragen; bestätigt wird er automatisch, sobald
-- sich genau diese E-Mail-Adresse per Google-Login anmeldet (siehe
-- api/google-login.js) - das ist die geforderte "Bestätigung durch Anmeldung
-- mit Google Account".
create table if not exists admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  status text not null default 'pending' check (status in ('pending', 'confirmed')),
  invited_by text not null,
  invited_at timestamptz not null default now(),
  confirmed_at timestamptz
);

-- Row Level Security aktivieren: Diese Tabellen werden ausschliesslich über
-- den Service-Role-Key aus den Vercel-Functions angesprochen (niemals vom
-- Browser direkt), daher hier bewusst KEINE Policies für "anon"/"authenticated" -
-- RLS ohne Policy = kompletter Zugriffsschutz vor dem Browser-Client, der
-- Service-Role-Key umgeht RLS ohnehin.
alter table feedback enable row level security;
alter table issue_reports enable row level security;
alter table error_logs enable row level security;
alter table admin_users enable row level security;
