#!/usr/bin/env bash
# Run only on explicitly disposable isolated QA services; never target a real drone.
set -euo pipefail
: "${QA_API:?}" "${QA_PG_CONTAINER:?}" "${QA_PG_DATABASE:?}" "${QA_NATIVE_CLI:?}" "${QA_ADMIN_USER:?}" "${QA_ADMIN_PASSWORD:?}"
[[ ${QA_DISPOSABLE:-} == yes && $QA_API =~ ^http://127\.0\.0\.1:([0-9]+)$ && ${BASH_REMATCH[1]} != 8081 ]] || { printf 'unsafe QA API\n' >&2; exit 2; }
[[ $QA_PG_CONTAINER =~ ^qa-telemetry-[a-z0-9-]+$ && $QA_PG_DATABASE =~ ^qa_telemetry_[a-z0-9_]+$ ]] || { printf 'unsafe QA database\n' >&2; exit 2; }
port=${QA_API##*:}
[[ ! $port =~ ^(80|443|3000|5432|6379|8000|8081)$ && ! $QA_PG_CONTAINER =~ (prod|primary|main) && ! $QA_PG_DATABASE =~ (prod|primary|main) ]] || { printf 'unsafe QA target\n' >&2; exit 2; }
base=$QA_API/api/v1
work=$(mktemp -d /tmp/qa-active-replan.XXXXXX)
trap 'rm "$work"/*; rmdir "$work"' EXIT
run=$(cat /proc/sys/kernel/random/uuid)
drone="replan-${run:0:8}"
post() { curl --max-time 15 --fail-with-body -sS -H 'Content-Type: application/json' "$@"; }
expect() { local want=$1; shift; local actual; actual=$(curl --max-time 15 -sS -o "$work/last" -w '%{http_code}' "$@"); if [[ $actual != "$want" ]]; then printf 'expected %s got %s: ' "$want" "$actual"; cat "$work/last"; exit 1; fi; printf 'PASS HTTP %s\n' "$actual"; }
post -c "$work/admin" -d "{\"username\":\"$QA_ADMIN_USER\",\"password\":\"$QA_ADMIN_PASSWORD\"}" "$base/admin/auth/login" >/dev/null
post -b "$work/admin" -d "{\"drone_id\":\"$drone\",\"capacity_grams\":1000,\"home_latitude\":37.499,\"home_longitude\":127,\"cruise_speed_mps\":5,\"max_altitude_m\":30,\"active\":false}" "$base/admin/fleet" >/dev/null
post -b "$work/admin" -d "{\"sku\":\"replan-$run\",\"name\":\"Synthetic replan\",\"unit_price\":1000,\"stock_quantity\":10}" "$base/inventory" > "$work/item"
item=$(jq -r .id "$work/item")
owner=$(cat /proc/sys/kernel/random/uuid); merchant=$(cat /proc/sys/kernel/random/uuid); category=$(cat /proc/sys/kernel/random/uuid)
docker exec -i "$QA_PG_CONTAINER" psql -U postgres -d "$QA_PG_DATABASE" -v ON_ERROR_STOP=1 > /dev/null <<SQL
INSERT INTO neurovector.customers(id,provider,subject,name) VALUES ('$owner','google','replan-$run','Synthetic merchant');
INSERT INTO neurovector.merchants(id,owner_id,name) VALUES ('$merchant','$owner','Synthetic');
INSERT INTO neurovector.product_categories(id,merchant_id,name) VALUES ('$category','$merchant','Synthetic');
INSERT INTO neurovector.product_details(item_id,merchant_id,category_id,weight_grams) VALUES ('$item','$merchant','$category',300);
SQL
for idx in 1 2; do if [[ $idx == 1 ]]; then lat=37.5; else lat=37.5001; fi; post -d "{\"customer_name\":\"replan-$idx\",\"customer_phone\":\"000\",\"items\":[{\"item_id\":\"$item\",\"quantity\":1}],\"delivery_address\":\"QA\",\"latitude\":$lat,\"longitude\":127}" "$base/orders" > "$work/order$idx"; order=$(jq -r .id "$work/order$idx"); post -d '{"simulate":"success"}' "$base/orders/$order/payments" >/dev/null; for status in preparing ready; do post -b "$work/admin" -X PATCH -d "{\"status\":\"$status\"}" "$base/orders/$order/status" >/dev/null; done; done
for idx in 1 2; do order=$(jq -r .id "$work/order$idx"); curl --max-time 5 -fsS "$base/orders/$order" | jq -e '.status=="ready" and .delivery_id==null' >/dev/null; done
started=$SECONDS
post -d '{"latitude":37.499,"longitude":127,"altitude_m":30,"speed_mps":0,"vertical_speed_mps":0,"battery_pct":90,"status":"idle"}' "$base/flights/telemetry/$drone" >/dev/null
post -b "$work/admin" -d "{\"drone_id\":\"$drone\",\"capacity_grams\":1000,\"home_latitude\":37.499,\"home_longitude\":127,\"cruise_speed_mps\":5,\"max_altitude_m\":30,\"active\":true}" "$base/admin/fleet" >/dev/null
order1=$(jq -r .id "$work/order1"); order2=$(jq -r .id "$work/order2")
for i in $(seq 1 20); do curl --max-time 5 -fsS "$base/orders/$order1" > "$work/order1live"; curl --max-time 5 -fsS "$base/orders/$order2" > "$work/order2live"; delivery=$(jq -r '.delivery_id // empty' "$work/order1live"); other=$(jq -r '.delivery_id // empty' "$work/order2live"); [[ -n $delivery && $delivery == "$other" && $(jq -r .status "$work/order1live") == assigned && $(jq -r .status "$work/order2live") == assigned ]] && break; sleep 1; done
[[ -n ${delivery:-} && $delivery == "$other" ]] || { printf 'orders were not batched\n'; exit 1; }
[[ $(jq -r .status "$work/order1live") == assigned && $(jq -r .status "$work/order2live") == assigned ]] || { printf 'cached orders did not show assignment\n'; exit 1; }
printf 'PASS cached ready orders refreshed after scheduler assignment in %ss\n' "$((SECONDS-started))"
curl --max-time 5 -fsS "$base/deliveries/$delivery" > "$work/delivery"; original=$(jq -r .route_id "$work/delivery")
curl --max-time 5 -fsS "$base/routes/plans/by-route/$original" > "$work/original"
verify() { local path=$1 id fingerprint; id=$(jq -r .id "$path"); fingerprint=$(jq -r .route_fingerprint "$path"); jq -jr .plan_text "$path" | "$QA_NATIVE_CLI" --drone-id "$drone" --fingerprint "$fingerprint" > "$work/check"; post --data-binary @"$work/check" "$base/routes/plans/$id/cross-check" > /dev/null; }
verify "$work/original"
post -b "$work/admin" -d "{\"delivery_id\":\"$delivery\",\"weight_grams\":600}" "$base/admin/fleet/$drone/payload-measurements" >/dev/null
for status in dispatched in_flight; do post -X PATCH -d "{\"status\":\"$status\"}" "$base/deliveries/$delivery/status" >/dev/null; done
for id in "$order1" "$order2"; do post -b "$work/admin" -X PATCH -d '{"status":"in_transit"}' "$base/orders/$id/status" >/dev/null; done
telemetry() { post -d "$1" "$base/flights/telemetry/$drone" > "$work/telemetry"; jq -r .id "$work/telemetry"; }
tid=$(telemetry '{"latitude":37.499,"longitude":127,"altitude_m":30,"speed_mps":0,"vertical_speed_mps":0,"battery_pct":90,"status":"flying"}')
expect 401 "$base/admin/deliveries/$delivery/stops"
curl --max-time 5 -fsS -b "$work/admin" "$base/admin/deliveries/$delivery/stops" > "$work/stops"; jq -e 'length==2 and .[0].stop_sequence==1 and .[1].stop_sequence==2' "$work/stops" >/dev/null
create_candidate() { local kind=$1; jq --arg kind "$kind" --arg drone "$drone" '{name:("replan-"+$kind),drone_id:$drone,cruise_speed_mps:5,max_altitude_m:30,waypoints:(if $kind=="missing" then [.payload.required_stops[0],.payload.required_stops[2],.payload.required_stops[3]] elif $kind=="changedalt" then [.payload.required_stops[0],(.payload.required_stops[1] | .altitude_m=29)]+.payload.required_stops[2:] elif $kind=="wronghome" then .payload.required_stops[0:3]+[{lat:37.4995,lon:127.0,altitude_m:30}] else [.payload.required_stops[0],{lat:37.4993,lon:127.0001,altitude_m:30}]+.payload.required_stops[1:] end)}' "$work/original" > "$work/input"; post --data-binary @"$work/input" "$base/routes/plan" > "$work/$kind"; }
create_candidate missing; verify "$work/missing"
create_candidate wronghome; verify "$work/wronghome"
create_candidate changedalt; verify "$work/changedalt"
create_candidate pending
create_candidate expired; verify "$work/expired"
create_candidate valid; verify "$work/valid"
activate() { local plan=$1 route=$2 telemetry_id=$3; printf '{"plan_id":"%s","expected_route_id":"%s","expected_telemetry_id":%s,"altitude_reference":"plan"}' "$plan" "$route" "$telemetry_id"; }
missing=$(jq -r .id "$work/missing"); wronghome=$(jq -r .id "$work/wronghome"); changedalt=$(jq -r .id "$work/changedalt"); pending=$(jq -r .id "$work/pending"); expired=$(jq -r .id "$work/expired"); valid=$(jq -r .id "$work/valid"); endpoint="$base/admin/deliveries/$delivery/activate-plan"
expect 401 -X POST -H 'Content-Type: application/json' -d "$(activate "$valid" "$original" "$tid")" "$endpoint"
for id in "$missing" "$wronghome" "$changedalt" "$pending"; do tid=$(telemetry '{"latitude":37.499,"longitude":127,"altitude_m":30,"speed_mps":0,"vertical_speed_mps":0,"battery_pct":90,"status":"flying"}'); expect 409 -b "$work/admin" -X POST -H 'Content-Type: application/json' -d "$(activate "$id" "$original" "$tid")" "$endpoint"; done
docker exec "$QA_PG_CONTAINER" psql -U postgres -d "$QA_PG_DATABASE" -v ON_ERROR_STOP=1 -c "UPDATE neurovector.mission_plans SET created_at=now()-interval '2 hours', expires_at=now()-interval '1 second' WHERE id='$expired'" >/dev/null
tid=$(telemetry '{"latitude":37.499,"longitude":127,"altitude_m":30,"speed_mps":0,"vertical_speed_mps":0,"battery_pct":90,"status":"flying"}')
expect 400 -b "$work/admin" -X POST -H 'Content-Type: application/json' -d "$(activate "$expired" "$original" "$tid")" "$endpoint"
expect 409 -b "$work/admin" -X POST -H 'Content-Type: application/json' -d "$(activate "$valid" "$original" 0)" "$endpoint"
tid=$(telemetry '{"latitude":37.499,"longitude":127,"altitude_m":30,"speed_mps":0,"battery_pct":90,"status":"flying"}')
expect 409 -b "$work/admin" -X POST -H 'Content-Type: application/json' -d "$(activate "$valid" "$original" "$tid")" "$endpoint"
tid=$(telemetry '{"latitude":37.499,"longitude":127,"altitude_m":30,"speed_mps":0,"vertical_speed_mps":2,"battery_pct":90,"status":"flying"}')
expect 409 -b "$work/admin" -X POST -H 'Content-Type: application/json' -d "$(activate "$valid" "$original" "$tid")" "$endpoint"
tid=$(telemetry '{"latitude":37.499,"longitude":127,"altitude_m":30,"speed_mps":2,"vertical_speed_mps":0,"battery_pct":90,"status":"flying"}')
expect 409 -b "$work/admin" -X POST -H 'Content-Type: application/json' -d "$(activate "$valid" "$original" "$tid")" "$endpoint"
tid=$(telemetry '{"latitude":37.499,"longitude":127,"altitude_m":30,"speed_mps":0,"vertical_speed_mps":0,"battery_pct":0,"status":"flying"}')
expect 409 -b "$work/admin" -X POST -H 'Content-Type: application/json' -d "$(activate "$valid" "$original" "$tid")" "$endpoint"
tid=$(telemetry '{"latitude":37.4991,"longitude":127,"altitude_m":30,"speed_mps":0,"vertical_speed_mps":0,"battery_pct":90,"status":"flying"}')
expect 409 -b "$work/admin" -X POST -H 'Content-Type: application/json' -d "$(activate "$valid" "$original" "$tid")" "$endpoint"
tid=$(telemetry '{"latitude":37.499,"longitude":127,"altitude_m":40,"speed_mps":0,"vertical_speed_mps":0,"battery_pct":90,"status":"flying"}')
expect 409 -b "$work/admin" -X POST -H 'Content-Type: application/json' -d "$(activate "$valid" "$original" "$tid")" "$endpoint"
tid=$(telemetry '{"latitude":37.499,"longitude":127,"altitude_m":30,"speed_mps":0,"vertical_speed_mps":0,"battery_pct":90,"status":"flying"}')
sleep 6
expect 409 -b "$work/admin" -X POST -H 'Content-Type: application/json' -d "$(activate "$valid" "$original" "$tid")" "$endpoint"
post -d '{"name":"temporary-changed-zone","polygon":[{"lat":39,"lon":129,"altitude_m":0},{"lat":39.001,"lon":129,"altitude_m":0},{"lat":39,"lon":129.001,"altitude_m":0}]}' "$base/routes/no-fly-zones" > "$work/zone"
zone=$(jq -r .id "$work/zone")
tid=$(telemetry '{"latitude":37.499,"longitude":127,"altitude_m":30,"speed_mps":0,"vertical_speed_mps":0,"battery_pct":90,"status":"flying"}')
expect 400 -b "$work/admin" -X POST -H 'Content-Type: application/json' -d "$(activate "$valid" "$original" "$tid")" "$endpoint"
curl --max-time 5 -fsS -X DELETE "$base/routes/no-fly-zones/$zone" >/dev/null
tid=$(telemetry '{"latitude":37.499,"longitude":127,"altitude_m":30,"speed_mps":0,"vertical_speed_mps":0,"battery_pct":90,"status":"flying"}')
body=$(activate "$valid" "$original" "$tid")
for i in 1 2; do curl --max-time 15 -sS -b "$work/admin" -o "$work/race$i" -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d "$body" "$endpoint" > "$work/code$i" & done; wait
codes=$(cat "$work/code1" "$work/code2" | sort | tr '\n' ' '); [[ $codes == '200 409 ' ]] || { printf 'activation race codes: %s\n' "$codes"; cat "$work/race1" "$work/race2"; exit 1; }
expect 409 -b "$work/admin" -X POST -H 'Content-Type: application/json' -d "$body" "$endpoint"
new_route=$(jq -r .route_id "$work/valid"); actual=$(curl --max-time 5 -fsS "$base/deliveries/$delivery" | jq -r .route_id); [[ $actual == "$new_route" ]]
events=$(docker exec "$QA_PG_CONTAINER" psql -U postgres -d "$QA_PG_DATABASE" -Atc "SELECT count(*) FROM neurovector.order_tracking_events WHERE event_type='mission_replanned' AND payload->>'plan_id'='$valid'"); [[ $events == 2 ]]
printf 'PASS concurrent activation exactly one commit, both stop audits, route bound\n'
