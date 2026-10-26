import json
import math
import os
import sys

import pytest

HERE = os.path.dirname(__file__)
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'python'))

from boheme_mp import simulate, to_jsonable
from boheme_mp import validation


def load(*p):
    with open(os.path.join(ROOT, *p), encoding='utf-8') as f:
        return json.load(f)


FIX = {'excel': load('tests', 'fixtures', 'excel_reference.json'), 'a320': load('tests', 'fixtures', 'a320_green.json')}
CHECKS = validation.run(FIX)


@pytest.mark.parametrize('check', CHECKS, ids=[c['group'] + ': ' + c['name'] for c in CHECKS])
def test_validation_suite(check):
    assert check['ok'], check['detail']


def compare(a, b, path, worst):
    if isinstance(a, dict) and isinstance(b, dict):
        assert set(a) == set(b), 'keys differ at ' + path + ': ' + str(sorted(set(a) ^ set(b)))
        for k in a:
            compare(a[k], b[k], path + '.' + k, worst)
    elif isinstance(a, list) and isinstance(b, list):
        assert len(a) == len(b), 'length differs at ' + path
        for i, (x, y) in enumerate(zip(a, b)):
            compare(x, y, path + '[' + str(i) + ']', worst)
    elif isinstance(a, bool) or isinstance(b, bool):
        assert a == b, path
    elif isinstance(a, (int, float)) and isinstance(b, (int, float)):
        if path.endswith('.residual'):
            assert abs(a - b) < 1e-12, 'residual differs at ' + path
            return
        d = abs(a - b) / max(abs(b), 1e-6)
        if d > worst[0]:
            worst[0], worst[1] = d, path
    else:
        assert a == b, 'value differs at ' + path + ': ' + repr(a) + ' vs ' + repr(b)


@pytest.mark.parametrize('example', ['power_pack_mission.json', 'a320_green.json', 'excel_reference.json'])
def test_python_equals_javascript(example):
    js = load('tests', 'fixtures', 'js_results.json')[example]
    py = json.loads(json.dumps(to_jsonable(simulate(load('examples', example)))))
    worst = [0.0, '']
    compare(py, js, example, worst)
    assert worst[0] < 1e-9, 'max relative deviation %.3e at %s' % (worst[0], worst[1])
