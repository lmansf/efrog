"""
efrog smoke test
Run: python smoke_test.py
Requires: pip install databricks-sql-connector

Set DATABRICKS_TOKEN in your environment before running:
  Windows:  $env:DATABRICKS_TOKEN = "dapiXXX..."
  macOS/Linux: export DATABRICKS_TOKEN=dapiXXX...
"""

import json
import os
import sys
import urllib.request
import urllib.error

RENDER_URL   = 'https://efrog.onrender.com'
AUTH0_DOMAIN = 'dev-rbxcy3tqjhebw7aa.us.auth0.com'
DBC_HOST     = 'dbc-e930fe9b-24ee.cloud.databricks.com'
DBC_PATH     = '/sql/1.0/warehouses/3693794c981549b0'
DBC_TOKEN    = os.environ.get('DATABRICKS_TOKEN', '')
DBC_CATALOG  = os.environ.get('DATABRICKS_CATALOG', '')
DBC_SCHEMA   = os.environ.get('DATABRICKS_SCHEMA', 'efrog')
DBC_PREFIX   = f'{DBC_CATALOG}.{DBC_SCHEMA}' if DBC_CATALOG else DBC_SCHEMA

_passed = _failed = 0

def ok(label):
    global _passed
    _passed += 1
    print(f'  \033[32mPASS\033[0m  {label}')

def fail(label, reason=''):
    global _failed
    _failed += 1
    print(f'  \033[31mFAIL\033[0m  {label}{f": {reason}" if reason else ""}')

def section(title):
    print(f'\n\033[1m{title}\033[0m')

def get(url, *, expect_status=200, timeout=20, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = json.loads(r.read())
            return r.status, body
    except urllib.error.HTTPError as e:
        return e.code, {}
    except Exception as e:
        return None, str(e)

def post(url, payload, *, headers=None, timeout=20):
    data = json.dumps(payload).encode()
    req  = urllib.request.Request(url, data=data, headers={
        'Content-Type': 'application/json',
        **(headers or {}),
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, {}
    except Exception as e:
        return None, str(e)


# ── 1. Render API ─────────────────────────────────────────────────────────────
section('1. Render API  (https://efrog.onrender.com)')

status, body = get(f'{RENDER_URL}/health', timeout=60)
if status == 200 and body.get('status') == 'ok':
    ok(f'/health → {body}')
else:
    fail('/health', f'status={status} body={body}')

# Auth-protected endpoints should reject missing tokens
status, _ = post(f'{RENDER_URL}/sync', {})
if status == 401:
    ok('/sync without token → 401 (auth guard works)')
else:
    fail('/sync without token', f'expected 401, got {status}')

status, _ = get(f'{RENDER_URL}/observations')
if status == 401:
    ok('/observations without token → 401 (auth guard works)')
else:
    fail('/observations without token', f'expected 401, got {status}')


# ── 2. Auth0 ──────────────────────────────────────────────────────────────────
section('2. Auth0')

status, body = get(f'https://{AUTH0_DOMAIN}/.well-known/jwks.json')
if status == 200 and body.get('keys'):
    ok(f'JWKS reachable — {len(body["keys"])} signing key(s)')
else:
    fail('JWKS endpoint', f'status={status}')

status, body = get(f'https://{AUTH0_DOMAIN}/.well-known/openid-configuration')
if status == 200 and 'issuer' in body:
    ok(f'OpenID config reachable — issuer: {body["issuer"]}')
else:
    fail('OpenID configuration', f'status={status}')


# ── 3. Databricks ─────────────────────────────────────────────────────────────
section('3. Databricks')

if not DBC_TOKEN:
    fail('Token', 'DATABRICKS_TOKEN env var not set — skipping Databricks tests')
else:
    try:
        from databricks import sql as dbc_sql

        with dbc_sql.connect(
            server_hostname=DBC_HOST,
            http_path=DBC_PATH,
            access_token=DBC_TOKEN,
        ) as conn:
            with conn.cursor() as cur:

                cur.execute('SELECT 1 AS ping')
                assert cur.fetchone()[0] == 1
                ok('Connection established')

                cur.execute(f"CREATE SCHEMA IF NOT EXISTS {DBC_PREFIX}")
                ok(f"Schema '{DBC_PREFIX}' ready")

                cur.execute(f"""
                    CREATE TABLE IF NOT EXISTS {DBC_PREFIX}.observations (
                        id            STRING,
                        user_id       STRING,
                        created_at    STRING,
                        type          STRING,
                        name          STRING,
                        species       STRING,
                        confidence    DOUBLE,
                        probabilities STRING
                    ) USING DELTA
                """)
                cur.execute(f"""
                    CREATE TABLE IF NOT EXISTS {DBC_PREFIX}.feedback (
                        id              STRING,
                        user_id         STRING,
                        observation_id  STRING,
                        created_at      STRING,
                        name            STRING,
                        accuracy_rating INT,
                        site_rating     INT,
                        frogwatch       STRING,
                        note            STRING,
                        species         STRING,
                        confidence      DOUBLE,
                        user_agent      STRING
                    ) USING DELTA
                """)
                ok("Tables 'observations' and 'feedback' ready")

                # Round-trip: insert → select → delete
                cur.execute(f"""
                    INSERT INTO {DBC_PREFIX}.observations VALUES
                    ('_smoke_', '_test_user_', '2026-01-01T00:00:00Z',
                     'upload', 'smoke.wav', 'cane_toad', 0.99, '{{"cane_toad":0.99}}')
                """)
                cur.execute(
                    f"SELECT id FROM {DBC_PREFIX}.observations WHERE id = '_smoke_'"
                )
                assert cur.fetchone(), 'inserted row not found'
                ok('Insert + select round-trip verified')

                cur.execute(
                    f"DELETE FROM {DBC_PREFIX}.observations WHERE id = '_smoke_'"
                )
                ok('Cleanup done')

    except ImportError:
        fail('databricks-sql-connector', 'not installed — run: pip install databricks-sql-connector')
    except Exception as e:
        fail('Databricks', e)


# ── Summary ───────────────────────────────────────────────────────────────────
total = _passed + _failed
print(f'\n{"─"*40}')
print(f'  {_passed}/{total} passed', end='')
if _failed:
    print(f'  (\033[31m{_failed} failed\033[0m)')
    sys.exit(1)
else:
    print('  \033[32m✓ all good\033[0m')
