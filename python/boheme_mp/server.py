import json
import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .solver import simulate, to_jsonable, validate_model
from . import validation

app = FastAPI(title='BOHEME Multiphysics API', version=__version__)
app.add_middleware(CORSMiddleware, allow_origins=os.environ.get('BMP_CORS', '*').split(','), allow_methods=['GET', 'POST'], allow_headers=['*'])
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


@app.get('/api/health')
def health():
    return {'ok': True, 'engine': 'python', 'version': __version__}


@app.post('/api/simulate')
def api_simulate(model: dict):
    errs = validate_model(model)
    if errs:
        raise HTTPException(status_code=422, detail=errs)
    try:
        return {'ok': True, 'result': to_jsonable(simulate(model))}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get('/api/validate')
def api_validate():
    fx = os.path.join(ROOT, 'tests', 'fixtures')
    with open(os.path.join(fx, 'excel_reference.json'), encoding='utf-8') as f:
        excel = json.load(f)
    with open(os.path.join(fx, 'a320_green.json'), encoding='utf-8') as f:
        a320 = json.load(f)
    res = validation.run({'excel': excel, 'a320': a320})
    return {'passed': sum(r['ok'] for r in res), 'total': len(res), 'checks': res}
