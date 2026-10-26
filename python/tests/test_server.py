import json
import os
import sys

import pytest

HERE = os.path.dirname(__file__)
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'python'))

fastapi = pytest.importorskip('fastapi')
from fastapi.testclient import TestClient
from boheme_mp.server import app

client = TestClient(app)


def test_health():
    r = client.get('/api/health')
    assert r.status_code == 200 and r.json()['engine'] == 'python'


def test_simulate_a320():
    with open(os.path.join(ROOT, 'examples', 'a320_green.json'), encoding='utf-8') as f:
        model = json.load(f)
    r = client.post('/api/simulate', json=model)
    assert r.status_code == 200
    res = r.json()['result']
    assert res['final']['hyd']['iterations'] == 125
    assert abs(res['final']['hyd']['nodes']['N02'] - 205.9998) < 1e-4


def test_invalid_model_rejected():
    r = client.post('/api/simulate', json={'nodes': [{'id': 'N01', 'domain': 'hyd'}], 'components': [{'name': 'R1', 'domain': 'hyd', 'cell': 'R1 1 10', 'n1': 'N01', 'n2': 'XX'}]})
    assert r.status_code == 422
    assert any('unknown node' in e for e in r.json()['detail'])


def test_validate_endpoint():
    r = client.get('/api/validate')
    assert r.status_code == 200 and r.json()['passed'] == r.json()['total'] == 24
