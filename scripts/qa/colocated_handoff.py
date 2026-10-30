#!/usr/bin/env python3
"""Run a two-order co-located handoff against the disposable QA backend.

Uses the same QA_DISPOSABLE and loopback/container checks as drone_delivery.py.
Only synthetic customer/catalog/session prerequisites are inserted with SQL;
orders, deliveries, plans, stops, telemetry and handoffs use the actual API.
"""
import hashlib
import concurrent.futures
import json
import os
import subprocess
import time
import uuid

from drone_delivery import (CLI, DRONE, OWNER_COOKIE, OWNER_TOKEN, RUN,
                            assert_guard, call, request, sql, wait_for)


def main() -> None:
    code, _, cookie = request('POST', '/admin/auth/login', {
        'username': os.environ['QA_ADMIN_USER'], 'password': os.environ['QA_ADMIN_PASSWORD'],
    })
    assert code == 200 and cookie
    admin = cookie.split(';', 1)[0]
    fleet = {'drone_id': DRONE, 'capacity_grams': 1000, 'home_latitude': 37.499,
             'home_longitude': 127.0, 'cruise_speed_mps': 5, 'max_altitude_m': 30,
             'active': False}
    call('POST', '/admin/fleet', fleet, admin)
    call('POST', '/flights/telemetry/' + DRONE, {'status':'idle', 'battery_pct':90}, expected=201)
    item = call('POST', '/inventory', {'sku':'colocated-'+RUN, 'name':'Synthetic',
                'unit_price':1000, 'stock_quantity':4}, admin, 201)['id']
    owner, merchant_owner, merchant, category = [str(uuid.uuid4()) for _ in range(4)]
    owner_hash = hashlib.sha256(OWNER_TOKEN.encode()).hexdigest()
    sql(f"""INSERT INTO neurovector.customers(id,provider,subject,name) VALUES
      ('{owner}','google','owner-{RUN}','Synthetic owner'),
      ('{merchant_owner}','google','merchant-{RUN}','Synthetic merchant');
      INSERT INTO neurovector.customer_sessions(token_hash,customer_id,expires_at)
      VALUES ('{owner_hash}','{owner}',now()+interval '1 day');
      INSERT INTO neurovector.merchants(id,owner_id,name) VALUES ('{merchant}','{merchant_owner}','Synthetic');
      INSERT INTO neurovector.product_categories(id,merchant_id,name) VALUES ('{category}','{merchant}','Synthetic');
      INSERT INTO neurovector.product_details(item_id,merchant_id,category_id,weight_grams)
      VALUES ('{item}','{merchant}','{category}',500);""")
    orders = []
    for _ in range(2):
        order = call('POST', '/orders', {'customer_name':'Synthetic', 'customer_phone':'000',
                     'items':[{'item_id':item,'quantity':1}], 'delivery_address':'Synthetic',
                     'latitude':37.5, 'longitude':127.0, 'handoff_pin':'654321'}, OWNER_COOKIE, 201)['id']
        call('POST', f'/orders/{order}/payments', {'simulate':'success'}, OWNER_COOKIE, 201)
        for status in ('preparing','ready'):
            call('PATCH', f'/orders/{order}/status', {'status':status}, admin)
        orders.append(order)
    call('POST', '/admin/fleet', fleet | {'active':True}, admin)
    def assignment():
        rows = sql(f"SELECT coalesce(string_agg(order_id::text,',' ORDER BY stop_sequence),'') FROM neurovector.delivery_stops WHERE delivery_id=(SELECT delivery_id FROM neurovector.orders WHERE id='{orders[0]}')")
        return rows.split(',') if len(rows.split(',')) == 2 else None
    first, second = wait_for('co-located batch', assignment, 40)
    assert set((first,second)) == set(orders)
    delivery_id = sql(f"SELECT delivery_id FROM neurovector.orders WHERE id='{first}'")
    delivery = call('GET', f'/deliveries/{delivery_id}')
    plan = call('GET', '/routes/plans/by-route/' + delivery['route_id'])
    points = plan['payload']['required_stops'][1:-1]
    assert len(points) == 2 and points[0] == points[1]
    assert plan['payload']['altitude_reference'] == 'home_relative'
    checker = subprocess.run([CLI,'--drone-id',DRONE,'--fingerprint',plan['route_fingerprint']],
                             input=plan['plan_text'], text=True, capture_output=True, check=True)
    assert call('POST', f"/routes/plans/{plan['id']}/cross-check", json.loads(checker.stdout))['status'] == 'verified'
    call('POST', f'/admin/fleet/{DRONE}/payload-measurements',
         {'delivery_id':delivery_id,'weight_grams':1000}, admin, 201)
    for order in (first, second):
        wait_for('assigned order', lambda: call('GET',f'/account/orders/{order}/tracking',cookie=OWNER_COOKIE)['order_status']=='assigned',20)
    for status in ('dispatched','in_flight'):
        call('PATCH',f'/deliveries/{delivery_id}/status',{'status':status})
    for order in (first,second):
        call('PATCH',f'/orders/{order}/status',{'status':'in_transit'},admin)
    path = '/flights/telemetry/' + DRONE
    pose = {'status':'flying','latitude':points[0]['lat'],'longitude':points[0]['lon'],
            'altitude_m':points[0]['altitude_m'],'altitude_reference':'home_relative',
            'speed_mps':0.0,'vertical_speed_mps':0.0}
    assert_guard('later stop before first arrival','POST',f'/orders/{second}/handoff',{'pin':'654321'},OWNER_COOKIE,409)
    def hold_until_arrived(order, start):
        while time.monotonic()-start < 35:
            call('POST',path,pose,expected=201)
            tracking = call('GET',f'/account/orders/{order}/tracking',cookie=OWNER_COOKIE)
            if tracking['arrived_at']:
                assert time.monotonic()-start >= 10
                return
            time.sleep(2)
        raise AssertionError('stable hold did not yield arrival')
    hold_until_arrived(first, time.monotonic())
    assert_guard('later stop before first completion','POST',f'/orders/{second}/handoff',{'pin':'654321'},OWNER_COOKIE,409)
    def recover_hover():
        for _ in range(7):
            time.sleep(2.7)
            call('POST',path,pose,expected=201)
    for label, change in [('wrong reference after arrival', {'altitude_reference':'mean_sea_level'}),
                          ('low altitude after arrival', {'altitude_m':2.4})]:
        call('POST',path,pose | change,expected=201)
        assert_guard(label,'POST',f'/orders/{first}/handoff',{'pin':'654321'},OWNER_COOKIE,409)
        recover_hover()
    time.sleep(6)
    assert_guard('stale pose after arrival','POST',f'/orders/{first}/handoff',{'pin':'654321'},OWNER_COOKIE,409)
    recover_hover()
    assert_guard('wrong PIN','POST',f'/orders/{first}/handoff',{'pin':'000000'},OWNER_COOKIE,401)
    # Hold the same advisory lock while a real telemetry ingest and PIN wait in
    # order. The completion boundary must be after release, not transaction start.
    with subprocess.Popen(['docker','exec','-i',os.environ['QA_PG_CONTAINER'],'psql','-U','postgres',
                           '-d',os.environ['QA_PG_DATABASE'],'-Atq','-v','ON_ERROR_STOP=1'],
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1) as locker:
        assert locker.stdin is not None and locker.stdout is not None
        locker.stdin.write(f"BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('{DRONE}',0)); SELECT 'LOCKED';\n")
        locker.stdin.flush()
        while locker.stdout.readline().strip() != 'LOCKED':
            if locker.poll() is not None:
                raise AssertionError('advisory lock fixture exited')
        def waiters():
            return int(sql("SELECT count(*) FROM pg_stat_activity WHERE wait_event='advisory' AND query LIKE '%pg_advisory_xact_lock%';"))
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            ingest = executor.submit(call,'POST',path,pose,'',201)
            wait_for('queued telemetry',lambda: waiters() >= 1,10)
            handoff = executor.submit(call,'POST',f'/orders/{first}/handoff',{'pin':'654321'},OWNER_COOKIE)
            wait_for('queued handoff',lambda: waiters() >= 2,10)
            boundary = sql('SELECT clock_timestamp()')
            locker.stdin.write('COMMIT;\n\\q\n')
            locker.stdin.flush()
            sample = ingest.result(timeout=15)
            assert handoff.result(timeout=15)['status'] == 'delivered'
    clock_check = sql(f"SELECT completed_at > '{boundary}'::timestamptz AND completed_at > (SELECT received_at FROM neurovector.telemetry WHERE id={sample['id']}) FROM neurovector.delivery_stops WHERE order_id='{first}'")
    assert clock_check == 't', 'completion timestamp predates lock release or accepted telemetry'
    clock_times = sql(f"SELECT (SELECT received_at FROM neurovector.telemetry WHERE id={sample['id']}), completed_at FROM neurovector.delivery_stops WHERE order_id='{first}'")
    print(f'PASS contended completion follows lock release={boundary}, accepted telemetry|completion={clock_times}',flush=True)
    assert_guard('first replay','POST',f'/orders/{first}/handoff',{'pin':'654321'},OWNER_COOKIE,409)
    assert_guard('second requires new hover','POST',f'/orders/{second}/handoff',{'pin':'654321'},OWNER_COOKIE,409)
    second_hold_started = time.monotonic()
    call('POST',path,pose,expected=201)
    assert_guard('second short hover','POST',f'/orders/{second}/handoff',{'pin':'654321'},OWNER_COOKIE,409)
    hold_until_arrived(second, second_hold_started)
    gap = float(sql(f"SELECT extract(epoch FROM (b.arrived_at-a.completed_at)) FROM neurovector.delivery_stops a JOIN neurovector.delivery_stops b ON b.delivery_id=a.delivery_id WHERE a.order_id='{first}' AND b.order_id='{second}'"))
    assert gap >= 10, f'next arrival gap too short: {gap}'
    print(f'PASS next arrival follows completion by {gap:.6f} seconds',flush=True)
    call('POST',f'/orders/{second}/handoff',{'pin':'654321'},OWNER_COOKIE)
    assert_guard('second replay','POST',f'/orders/{second}/handoff',{'pin':'654321'},OWNER_COOKIE,409)
    assert call('GET',f'/deliveries/{delivery_id}')['status'] == 'completed'
    counts = sql(f"SELECT count(*) FILTER (WHERE consumed_at IS NOT NULL) FROM neurovector.order_handoffs WHERE order_id IN ('{first}','{second}')")
    assert counts == '2'
    print('PASS identical 3D stops completed in order after separate 10 second holds; two PINs consumed once',flush=True)


if __name__ == '__main__':
    main()
