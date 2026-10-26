# Growth ingest load test and replica-kill drill (D-ENG-08)

Two operator tools under `scripts/growth/`. Both write only synthetic rows
(`event_name = 'loadtest.synthetic'`, `is_internal = true`, random subject
keys, no props, no location) tagged with a run id in `session_key`, and delete
them afterwards unless `--keep`. Hosts that look like production
(`prod`/`production`/`live` in the hostname) are refused unless
`--allow-production` is passed; only do that inside an agreed window.
Credentials come from `CLICKHOUSE_USER` / `CLICKHOUSE_PASSWORD` and are never
printed.

## Load test (target 5,000 events/s)

```sh
CLICKHOUSE_USER=… CLICKHOUSE_PASSWORD=… \
node scripts/growth/clickhouse-load-test.cjs --url=https://ch-staging:8443 \
  --eps=5000 --seconds=300 --batch=500 --concurrency=8 --p99-ms=1000
```

Passes when there are no insert errors, achieved rate ≥ 95% of target, insert
p99 ≤ `--p99-ms`, and every row sent is readable. Exit code 1 on a miss, 2 on a
setup error. CI runs a 2,000 ev/s × 10 s smoke against the pinned single-node
fixture on a scratch table; the 5k/s figure has to be proven on staging
hardware, not CI.

## Replica-kill drill

```sh
node scripts/growth/replica-kill-drill.cjs \
  --replicas=https://ch1:8443,https://ch2:8443 --victim=https://ch2:8443 \
  --stop-cmd="ssh ch2 sudo systemctl stop clickhouse-server" \
  --start-cmd="ssh ch2 sudo systemctl start clickhouse-server" \
  --write-seconds=120 --eps=1000 --catchup-timeout=900          # dry run: prints the plan
# add --execute to run it
```

Steps: baseline (no replication lag) → stop victim → write through a survivor
→ survivors see every row → start victim → wait until `system.replicas` shows
no delay/queue and the victim has every row → cleanup. The stop/start commands
are supplied by the operator; the tool never builds commands from remote data.

Record each staging run (date, hardware, result JSON) in the ops log. Running
these against real staging/production clusters is an operations task, not
something CI can prove.
