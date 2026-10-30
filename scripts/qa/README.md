# Disposable delivery QA

Run this only with a disposable database, broker and backend. `drone_delivery.py` requires `QA_DISPOSABLE=yes`, an HTTP endpoint at a literal loopback address on a dedicated non-production port, PostgreSQL/Redis container names beginning `qa-telemetry-`, and a database name beginning `qa_telemetry_`. These checks reject obvious unsafe targets before any HTTP request or Docker invocation; they cannot prove that a backend really connects to the named database, so the operator must start the isolated backend as shown below. The harness creates synthetic accounts, sessions and catalog associations and performs real product API writes; it does not write delivery, route, stop or mission rows directly.

From the workspace root, with Docker, Rust, CMake and OpenSSL installed, this shell session creates a fresh isolated environment and generates disposable credentials without putting them in this document:

```bash
set -euo pipefail
QA_DB_PASSWORD=$(openssl rand -hex 24)
QA_ADMIN_PASSWORD=$(openssl rand -hex 24)
export QA_DISPOSABLE=yes QA_API=http://127.0.0.1:8085
export QA_PG_CONTAINER=qa-telemetry-example-pg QA_PG_DATABASE=qa_telemetry_example
export QA_REDIS_CONTAINER=qa-telemetry-example-redis
export QA_ADMIN_USER=qa-example-admin QA_ADMIN_PASSWORD
export QA_NATIVE_CLI=/tmp/qa-telemetry-example-native/nv_route_check

docker run -d --name "$QA_PG_CONTAINER" -e POSTGRES_PASSWORD="$QA_DB_PASSWORD" \
  -e POSTGRES_DB="$QA_PG_DATABASE" -p 127.0.0.1:15438:5432 postgres:16-alpine
docker run -d --name "$QA_REDIS_CONTAINER" -p 127.0.0.1:16388:6379 redis:7-alpine
docker run -d --name qa-telemetry-example-mqtt -p 127.0.0.1:18888:1883 \
  eclipse-mosquitto:2.0 mosquitto -c /mosquitto-no-auth.conf
for attempt in $(seq 1 60); do
  if docker exec "$QA_PG_CONTAINER" pg_isready -h 127.0.0.1 -U postgres -d "$QA_PG_DATABASE" >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$QA_PG_CONTAINER" psql -U postgres -d "$QA_PG_DATABASE" -v ON_ERROR_STOP=1 \
  -c 'CREATE SCHEMA neurovector; CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'
for migration in backend/migrations/*.sql; do
  docker exec -i "$QA_PG_CONTAINER" psql -U postgres -d "$QA_PG_DATABASE" -v ON_ERROR_STOP=1 < "$migration"
done
cmake -S drone -B /tmp/qa-telemetry-example-native -DCMAKE_BUILD_TYPE=Debug
cmake --build /tmp/qa-telemetry-example-native -j 4
cargo build --manifest-path backend/Cargo.toml
DATABASE_URL="postgres://postgres:${QA_DB_PASSWORD}@127.0.0.1:15438/${QA_PG_DATABASE}" \
REDIS_URL=redis://127.0.0.1:16388 LISTEN_ADDR=127.0.0.1:8085 ROUTE_POWER_W=120 \
AUTOMATIC_PLAN_ALTITUDE_REFERENCE=home_relative \
ADMIN_USERNAME="$QA_ADMIN_USER" ADMIN_PASSWORD="$QA_ADMIN_PASSWORD" \
MQTT_PORT=18888 MQTT_TOPIC_PREFIX=qa-telemetry-example MQTT_CLIENT_ID=qa-telemetry-example \
KAFKA_BROKERS=127.0.0.1:19098 KAFKA_TOPIC_ORDERS=qa-telemetry-example-orders \
KAFKA_TOPIC_EVENTS=qa-telemetry-example-events RUST_LOG=error \
  backend/target/debug/neurovector-backend >/tmp/qa-telemetry-example-server.log 2>&1 &
QA_SERVER_PID=$!
for attempt in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8085/health/ready >/dev/null; then break; fi
  sleep 1
done
python3 scripts/qa/test_drone_delivery_safety.py
python3 scripts/qa/drone_delivery.py
```

Run the migration replay regression against a second empty disposable database in the same container:

```bash
docker exec "$QA_PG_CONTAINER" createdb -U postgres qa_telemetry_migration_test
QA_PG_DATABASE=qa_telemetry_migration_test bash backend/tests/telemetry_authority_migration.sh
```

When finished, stop only these named resources and remove their temporary build and log:

```bash
kill "$QA_SERVER_PID"
wait "$QA_SERVER_PID" || true
docker stop "$QA_PG_CONTAINER" "$QA_REDIS_CONTAINER" qa-telemetry-example-mqtt
docker container rm "$QA_PG_CONTAINER" "$QA_REDIS_CONTAINER" qa-telemetry-example-mqtt
rm -r /tmp/qa-telemetry-example-native
rm /tmp/qa-telemetry-example-server.log
unset QA_DB_PASSWORD QA_ADMIN_PASSWORD
```
