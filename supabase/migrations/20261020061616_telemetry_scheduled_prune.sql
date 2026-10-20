-- Phase 15.5b (2026-10-20): scheduled retention for usage reports. Until now rows older than 90 days were
-- pruned only inside ingest_events, delete_install and the two reviewer reads, so while nothing called them (the
-- kill switch on, no reviewer) a report could outlive the 90 days the policy states. pg_cron, which Supabase
-- Postgres bundles hosted and locally, now runs telemetry.prune_expired() once a day; it loops the bounded
-- telemetry.prune(1000) until nothing older than 90 days remains (raw rows and both day counters). The job
-- runs as the role that scheduled it (postgres, the owner of the telemetry tables); no new grant to anon,
-- authenticated or service_role.
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create function telemetry.prune_expired()
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  removed integer;
  total integer := 0;
begin
  -- Take today's global counter row first, as ingest_events does before it prunes. Ingest then waits at that
  -- row for this run (a day's backlog, at most 20,000 rows under the cap: seconds) instead of locking some old
  -- rows of a tie in received_at and waiting on others this run holds, which could deadlock the two.
  insert into telemetry.days(day, count) values ((now() at time zone 'UTC')::date, 0) on conflict (day) do nothing;
  perform 1 from telemetry.days where day = (now() at time zone 'UTC')::date for update;
  loop
    removed := telemetry.prune(1000);
    total := total + removed;
    -- Each round is one bounded delete; the ceiling only guards against a runaway loop (the day caps keep a
    -- day's backlog far below it).
    exit when removed < 1000 or total >= 1000000;
  end loop;
  return total;
end;
$$;
revoke all on function telemetry.prune_expired() from public, anon, authenticated, service_role;
comment on function telemetry.prune_expired() is
  'Scheduled retention (pg_cron job telemetry-prune, daily at 03:17 UTC): deletes every usage report and day counter older than 90 days, 1000 rows a round, and returns the number of reports removed.';

-- cron.schedule with a job name is an upsert, so a re-run (db reset, a repeated push) keeps one job.
select cron.schedule('telemetry-prune', '17 3 * * *', 'select telemetry.prune_expired()');
