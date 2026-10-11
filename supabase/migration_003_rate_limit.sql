-- Migration 003: Rate-Limiting + zusätzliche Zugriffssperren.
-- Einmalig im Supabase SQL-Editor ausführen (sicher wiederholbar).

-- Zähler pro Schlüssel und Zeitfenster. Der Schlüssel ist ein Hash (siehe
-- api/_ratelimit.js) - es stehen keine E-Mail-Adressen/IPs im Klartext drin.
create table if not exists rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);
alter table rate_limits enable row level security;

-- Atomares "Zähler erhöhen und neuen Stand zurückgeben". Fixed-Window:
-- das Fenster ergibt sich aus der aktuellen Zeit geteilt durch die Fensterlänge.
create or replace function rate_limit_hit(p_key text, p_window_seconds integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz;
  v_count integer;
begin
  if p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'invalid window';
  end if;

  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into rate_limits (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = rate_limits.count + 1
  returning count into v_count;

  -- gelegentliches Aufräumen alter Fenster (ca. 1 % der Aufrufe)
  if random() < 0.01 then
    delete from rate_limits where window_start < now() - interval '2 days';
  end if;

  return v_count;
end;
$$;

-- Nur der Service-Role-Key (also nur unser Server) darf die Funktion aufrufen.
revoke all on function rate_limit_hit(text, integer) from public, anon, authenticated;
grant execute on function rate_limit_hit(text, integer) to service_role;

-- Defense in depth: RLS ohne Policy sperrt anon/authenticated bereits aus,
-- zusätzlich entziehen wir ihnen auch die Tabellenrechte komplett.
revoke all on table feedback, issue_reports, error_logs, admin_users, rate_limits from anon, authenticated;
