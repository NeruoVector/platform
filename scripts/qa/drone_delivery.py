#!/usr/bin/env python3
"""Exercise an automatic delivery on an already-isolated backend and database.

Requires QA_DISPOSABLE=yes, QA_API, QA_PG_CONTAINER, QA_PG_DATABASE, QA_REDIS_CONTAINER,
QA_NATIVE_CLI, QA_ADMIN_USER and QA_ADMIN_PASSWORD. This creates synthetic
accounts, sessions and catalog associations; use only a disposable database.
"""
import datetime as dt
import concurrent.futures
import hashlib
import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.request
import urllib.parse
import uuid

def validate_targets() -> None:
    """Reject non-disposable targets before any request or Docker invocation."""
    if os.environ.get('QA_DISPOSABLE') != 'yes':
        raise SystemExit('Set QA_DISPOSABLE=yes only for a disposable isolated environment')
    api = urllib.parse.urlsplit(os.environ['QA_API'])
    if (api.scheme != 'http' or api.hostname not in ('127.0.0.1', '::1')
            or api.username or api.password or api.path not in ('', '/')
            or api.query or api.fragment or api.port is None
            or api.port in (80, 443, 3000, 5432, 6379, 8000, 8081)):
        raise SystemExit('QA_API must be a dedicated loopback HTTP endpoint')
    names = [os.environ['QA_PG_CONTAINER'], os.environ['QA_REDIS_CONTAINER']]
    if any(not re.fullmatch(r'qa-telemetry-[a-z0-9-]+', name)
           or any(word in name for word in ('prod', 'primary', 'main')) for name in names):
        raise SystemExit('containers must use disposable qa-telemetry- names')
    database = os.environ['QA_PG_DATABASE']
    if (not re.fullmatch(r'qa_telemetry_[a-z0-9_]+', database)
            or any(word in database for word in ('prod', 'primary', 'main'))):
        raise SystemExit('database must use a disposable qa_telemetry_ name')


validate_targets()
BASE = os.environ['QA_API'].rstrip('/') + '/api/v1'
PG = os.environ['QA_PG_CONTAINER']
DB = os.environ['QA_PG_DATABASE']
REDIS = os.environ['QA_REDIS_CONTAINER']
CLI = os.environ['QA_NATIVE_CLI']
RUN = uuid.uuid4().hex[:12]
DRONE = f'integration-{RUN}'
OWNER_TOKEN = uuid.uuid4().hex + uuid.uuid4().hex
OTHER_TOKEN = uuid.uuid4().hex + uuid.uuid4().hex
OWNER_COOKIE = 'nv_customer=' + OWNER_TOKEN
OTHER_COOKIE = 'nv_customer=' + OTHER_TOKEN


def sql(query: str) -> str:
    return subprocess.run(
        ['docker', 'exec', '-i', PG, 'psql', '-U', 'postgres', '-d', DB,
         '-v', 'ON_ERROR_STOP=1', '-At'],
        input=query, text=True, check=True, capture_output=True,
    ).stdout.strip()


def request(method: str, path: str, data: dict | None = None, cookie: str = '') -> tuple[int, dict, str]:
    body = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(BASE + path, data=body, method=method,
                                 headers={'Content-Type': 'application/json', 'Cookie': cookie})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else {}, response.headers.get('Set-Cookie', '')
    except urllib.error.HTTPError as error:
        raw = error.read()
        return error.code, json.loads(raw) if raw else {}, ''


def call(method: str, path: str, data: dict | None = None, cookie: str = '', expected: int = 200) -> dict:
    code, result, _ = request(method, path, data, cookie)
    if code != expected:
        raise AssertionError(f'{method} {path}: expected {expected}, got {code}: {result}')
    return result


def wait_for(label: str, function, timeout: float = 25.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = function()
        if value:
            return value
        time.sleep(.25)
    raise AssertionError(f'timed out: {label}')


def redis_status() -> dict | None:
    value = subprocess.run(['docker', 'exec', REDIS, 'redis-cli', '--raw', 'GET',
                            f'neurovector:drone:{DRONE}:status'],
                           text=True, check=True, capture_output=True).stdout.strip()
    return json.loads(value) if value else None


def assert_guard(name: str, method: str, path: str, data: dict, cookie: str, expected: int) -> None:
    code, result, _ = request(method, path, data, cookie)
    if code != expected:
        raise AssertionError(f'{name}: expected {expected}, got {code}: {result}')
    print(f'PASS {name}: HTTP {code}', flush=True)


def main() -> None:
    code, _, set_cookie = request('POST', '/admin/auth/login', {
        'username': os.environ['QA_ADMIN_USER'], 'password': os.environ['QA_ADMIN_PASSWORD'],
    })
    if code != 200 or not set_cookie:
        raise AssertionError(f'admin login failed: {code}')
    admin_cookie = set_cookie.split(';', 1)[0]
    call('POST', '/admin/fleet', {'drone_id': DRONE, 'capacity_grams': 1000,
         'home_latitude': 37.499, 'home_longitude': 127.0, 'cruise_speed_mps': 5,
         'max_altitude_m': 30}, admin_cookie)
    call('POST', '/flights/telemetry/' + DRONE, {'status': 'idle', 'battery_pct': 90}, expected=201)
    call('POST', '/flights/telemetry/' + DRONE, {'status': 'failed', 'ts': '2000-01-01T00:00:00Z'}, expected=201)
    item = call('POST', '/inventory', {'sku': 'integration-' + RUN, 'name': 'Synthetic',
                'unit_price': 1000, 'stock_quantity': 5}, admin_cookie, 201)['id']
    owner, other, merchant_owner, merchant, category = [str(uuid.uuid4()) for _ in range(5)]
    owner_hash = hashlib.sha256(OWNER_TOKEN.encode()).hexdigest()
    other_hash = hashlib.sha256(OTHER_TOKEN.encode()).hexdigest()
    # Fixture setup only: no delivery, stop, route, mission, or order writes.
    sql(f"""
      INSERT INTO neurovector.customers(id,provider,subject,name) VALUES
        ('{owner}','google','owner-{RUN}','Synthetic owner'),
        ('{other}','google','other-{RUN}','Synthetic other'),
        ('{merchant_owner}','google','merchant-{RUN}','Synthetic merchant');
      INSERT INTO neurovector.customer_sessions(token_hash,customer_id,expires_at) VALUES
        ('{owner_hash}','{owner}',now()+interval '1 day'),
        ('{other_hash}','{other}',now()+interval '1 day');
      INSERT INTO neurovector.merchants(id,owner_id,name) VALUES ('{merchant}','{merchant_owner}','Synthetic');
      INSERT INTO neurovector.product_categories(id,merchant_id,name) VALUES ('{category}','{merchant}','Synthetic');
      INSERT INTO neurovector.product_details(item_id,merchant_id,category_id,weight_grams)
      VALUES ('{item}','{merchant}','{category}',500);
    """)
    order = call('POST', '/orders', {'customer_name': 'Synthetic', 'customer_phone': '000',
                 'items': [{'item_id': item, 'quantity': 1}], 'delivery_address': 'Synthetic',
                 'latitude': 37.5, 'longitude': 127.0, 'handoff_pin': '654321'}, OWNER_COOKIE, 201)['id']
    call('POST', f'/orders/{order}/payments', {'simulate': 'success'}, OWNER_COOKIE, 201)
    for status in ('preparing', 'ready'):
        def transition():
            code, result, _ = request('PATCH', f'/orders/{order}/status', {'status': status}, admin_cookie)
            if code not in (200, 409):
                raise AssertionError(f'order transition: HTTP {code}: {result}')
            if code == 409:
                state = sql(f"SELECT o.status, o.delivery_id IS NOT NULL, EXISTS (SELECT 1 FROM neurovector.delivery_stops s WHERE s.order_id=o.id AND s.delivery_id=o.delivery_id) FROM neurovector.orders o WHERE o.id='{order}'")
                expected_state = 'paid' if status == 'preparing' else 'preparing'
                if result.get('message') != 'conflict: delivery assignment changed during status update' or state != f'{expected_state}|t|t':
                    raise AssertionError(f'unexpected transition conflict: {result}, state={state}')
            return code == 200
        wait_for(f'order {status}', transition, 10)
    delivery = wait_for('automatic scheduler', lambda: next(iter(call('GET', '/deliveries?drone_id=' + DRONE)), None), 35)
    delivery_id, route_id = delivery['id'], delivery['route_id']
    order_row = sql(f"SELECT count(*) FROM neurovector.delivery_stops WHERE delivery_id='{delivery_id}' AND order_id='{order}'")
    assert order_row == '1', f'scheduler did not link the same order: {order_row}'
    plan = call('GET', '/routes/plans/by-route/' + route_id)
    assert plan['status'] == 'planned' and plan['route_id'] == route_id and plan['plan_text'].startswith('NVPLAN2 ')
    payload = plan['payload']
    assert payload['altitude_reference'] == 'home_relative', 'start private backend with AUTOMATIC_PLAN_ALTITUDE_REFERENCE=home_relative'
    selected = payload['candidates'][payload['selected_index']]['waypoints']
    required = payload['required_stops']
    assert len(required) >= 3 and required[0]['lat'] == 37.499 and required[-1]['lat'] == 37.499
    assert any(abs(p['lat'] - 37.5) < 1e-9 and abs(p['lon'] - 127.0) < 1e-9 for p in required[1:-1])
    assert selected[0] == required[0] and selected[-1] == required[-1]
    cursor = iter(selected)
    for stop in required:
        assert any(point == stop for point in cursor), 'selected route omitted or reordered a required stop'
    assert payload['validations'][payload['selected_index']]['distance_m'] > 200
    print('PASS scheduler produced linked pending NVPLAN2 with customer and return, distance >200m', flush=True)
    for status in ('assigned',):
        # Scheduler synchronizes ready orders to assigned on its next tick.
        wait_for('assigned order', lambda: call('GET', f'/account/orders/{order}/tracking', cookie=OWNER_COOKIE)['order_status'] == status, 20)
    measure_path = f'/admin/fleet/{DRONE}/payload-measurements'
    call('POST', measure_path, {'delivery_id': delivery_id, 'weight_grams': 500}, admin_cookie, 201)
    assert_guard('unverified mission', 'PATCH', f'/deliveries/{delivery_id}/status', {'status':'dispatched'}, '', 400)
    report = subprocess.run([CLI, '--drone-id', DRONE, '--fingerprint', plan['route_fingerprint']],
                            input=plan['plan_text'], text=True, check=True, capture_output=True)
    cross = json.loads(report.stdout)
    assert cross['valid'] and cross['distance_m'] > 200
    verified = call('POST', f"/routes/plans/{plan['id']}/cross-check", cross)
    assert verified['status'] == 'verified' and verified['route_id'] == route_id
    overweight = call('POST', measure_path, {'delivery_id': delivery_id, 'weight_grams': 1200}, admin_cookie, 201)
    assert overweight['capacity_exceeded']
    assert_guard('overweight measurement', 'PATCH', f'/deliveries/{delivery_id}/status', {'status':'dispatched'}, '', 409)
    call('POST', measure_path, {'delivery_id': delivery_id, 'weight_grams': 500}, admin_cookie, 201)
    for status in ('dispatched', 'in_flight'):
        call('PATCH', f'/deliveries/{delivery_id}/status', {'status':status})
    call('PATCH', f'/orders/{order}/status', {'status':'in_transit'}, admin_cookie)
    assert_guard('wrong owner', 'POST', f'/orders/{order}/handoff', {'pin':'654321'}, OTHER_COOKIE, 404)
    assert_guard('premature handoff', 'POST', f'/orders/{order}/handoff', {'pin':'654321'}, OWNER_COOKIE, 409)
    first = call('POST', '/flights/telemetry/' + DRONE, {'latitude':37.5,'longitude':127.0,
                 'speed_mps':.2,'status':'flying'}, expected=201)
    # These replays must not take authority or break the accepted arrival window.
    for stamp in ('2000-01-01T00:00:00Z', first['ts'],
                  (dt.datetime.now(dt.timezone.utc)+dt.timedelta(hours=1)).isoformat()):
        call('POST', '/flights/telemetry/' + DRONE, {'ts':stamp,'status':'landed'}, expected=201)
    status = call('GET', '/flights/status/' + DRONE)
    cached = redis_status()
    assert status['last_seen'] == first['ts'] and status['flight_id'] == first['flight_id']
    assert cached and cached['latest']['id'] == first['id'] and status['online'] == cached['online']
    tracking = call('GET', f'/account/orders/{order}/tracking', cookie=OWNER_COOKIE)
    assert tracking['drone']['observed_at'] == first['ts'] and not tracking['drone']['stale']
    accepted = sql(f"SELECT count(*) FILTER (WHERE accepted_for_current_state), count(*) FILTER (WHERE NOT accepted_for_current_state) FROM neurovector.telemetry WHERE drone_id='{DRONE}'")
    assert accepted == '2|4', f'incorrect authority markers: {accepted}'
    print(f'PASS ignored replay preserves current status and cache; accepted|ignored={accepted}', flush=True)
    # Simulate a pre-fix 2D arrival in the isolated database; it must not authorize PIN.
    sql(f"UPDATE neurovector.delivery_stops SET status='arrived', arrived_at=now() WHERE order_id='{order}'")
    assert_guard('legacy arrived flag with missing altitude', 'POST', f'/orders/{order}/handoff', {'pin':'654321'}, OWNER_COOKIE, 409)
    target_altitude = next(p['altitude_m'] for p in required if abs(p['lat'] - 37.5) < 1e-9 and abs(p['lon'] - 127.0) < 1e-9)
    pose = {'latitude':37.5, 'longitude':127.0, 'altitude_m':target_altitude,
            'altitude_reference':'home_relative', 'speed_mps':.2, 'vertical_speed_mps':0, 'status':'flying'}
    for label, delta in [('unknown datum', {'altitude_reference':None}),
                         ('wrong datum', {'altitude_reference':'mean_sea_level'}),
                         ('low altitude', {'altitude_m':2.4}),
                         ('moving vertically', {'vertical_speed_mps':2}),
                         ('moving horizontally', {'speed_mps':2})]:
        call('POST', '/flights/telemetry/' + DRONE, pose | delta, expected=201)
        assert_guard(label, 'POST', f'/orders/{order}/handoff', {'pin':'654321'}, OWNER_COOKIE, 409)
    sql(f"UPDATE neurovector.delivery_stops SET status='scheduled', arrived_at=NULL WHERE order_id='{order}'")
    time.sleep(3)
    call('POST', '/flights/telemetry/' + DRONE, pose, expected=201)
    tracking = call('GET', f'/account/orders/{order}/tracking', cookie=OWNER_COOKIE)
    assert tracking['arrived_at'] is None
    assert_guard('short hold handoff', 'POST', f'/orders/{order}/handoff', {'pin':'654321'}, OWNER_COOKIE, 409)
    for _ in range(9):
        time.sleep(3)
        call('POST', '/flights/telemetry/' + DRONE, pose, expected=201)
        tracking = call('GET', f'/account/orders/{order}/tracking', cookie=OWNER_COOKIE)
        if tracking['arrived_at']:
            break
    assert tracking['arrived_at'] and tracking['arrival_notification_id']
    events = sql(f"SELECT count(*) FROM neurovector.order_tracking_events WHERE order_id='{order}' AND event_type='arrived'")
    assert events == '1', f'arrival events: {events}'
    # Each invalid current sample interrupts a previously complete hold; recover
    # a full valid hold before testing the next independent failure.
    for label, delta in [('missing altitude after hover', {'altitude_m':None}),
                         ('unknown datum after hover', {'altitude_reference':None}),
                         ('wrong datum after hover', {'altitude_reference':'mean_sea_level'}),
                         ('low altitude after hover', {'altitude_m':2.4}),
                         ('vertical motion after hover', {'vertical_speed_mps':2}),
                         ('horizontal motion after hover', {'speed_mps':2}),
                         ('nearby wrong position after hover', {'latitude':37.5001})]:
        call('POST', '/flights/telemetry/' + DRONE, pose | delta, expected=201)
        assert_guard(label, 'POST', f'/orders/{order}/handoff', {'pin':'654321'}, OWNER_COOKIE, 409)
        for _ in range(7):
            time.sleep(2.5)
            call('POST', '/flights/telemetry/' + DRONE, pose, expected=201)
    time.sleep(6)
    assert_guard('stale current pose after arrival', 'POST', f'/orders/{order}/handoff', {'pin':'654321'}, OWNER_COOKIE, 409)
    for _ in range(7):
        call('POST', '/flights/telemetry/' + DRONE, pose, expected=201)
        time.sleep(2.5)
    sql(f"UPDATE neurovector.mission_plans SET payload=payload-'altitude_reference' WHERE id='{plan['id']}'")
    assert_guard('legacy unknown plan datum', 'POST', f'/orders/{order}/handoff', {'pin':'654321'}, OWNER_COOKIE, 409)
    sql(f"UPDATE neurovector.mission_plans SET payload=jsonb_set(payload, '{{altitude_reference}}', '\"home_relative\"') WHERE id='{plan['id']}'")
    # Competing requests take the real activation and handoff lock paths.
    telemetry_id = int(sql(f"SELECT id FROM neurovector.current_drone_telemetry WHERE drone_id='{DRONE}'"))
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        pin_request = executor.submit(request, 'POST', f'/orders/{order}/handoff', {'pin':'000000'}, OWNER_COOKIE)
        activation_request = executor.submit(request, 'POST', f'/admin/deliveries/{delivery_id}/activate-plan',
            {'plan_id':plan['id'], 'expected_route_id':route_id, 'expected_telemetry_id':telemetry_id, 'altitude_reference':'plan'}, admin_cookie)
        pin_code = pin_request.result(timeout=10)[0]
        activation_code = activation_request.result(timeout=10)[0]
    assert (pin_code, activation_code) == (401, 409), (pin_code, activation_code)
    print('PASS concurrent handoff and activation return without deadlock: HTTP 401/409', flush=True)
    delivered = call('POST', f'/orders/{order}/handoff', {'pin':'654321'}, OWNER_COOKIE)
    assert delivered['status'] == 'delivered'
    assert_guard('handoff replay', 'POST', f'/orders/{order}/handoff', {'pin':'654321'}, OWNER_COOKIE, 409)
    samples = sql(f"SELECT extract(epoch FROM max(received_at)-min(received_at)) FROM neurovector.telemetry WHERE drone_id='{DRONE}' AND accepted_for_current_state AND status='flying'")
    assert float(samples) >= 10, f'receive-time window too short: {samples}'
    print(f'PASS delivery arrived once and was delivered; accepted receive window {samples}s', flush=True)
    print('PASS automatic delivery end-to-end with isolated legacy-state fixtures', flush=True)


if __name__ == '__main__':
    main()
