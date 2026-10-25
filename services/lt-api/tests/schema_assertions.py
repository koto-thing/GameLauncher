"""実HTTP応答を共有契約の具体Schemaで検証する（参照はローカルのみ）"""
import json,re
from pathlib import Path
from urllib.parse import urlsplit
from jsonschema import Draft202012Validator,FormatChecker
root=Path(__file__).resolve().parents[3]/'contracts'/'lt'
schema=json.loads((root/'dto.schema.json').read_text(encoding='utf-8'))
routes=json.loads((root/'routes.json').read_text(encoding='utf-8'))

def assert_response(path,method,status,value):
 path=urlsplit(path).path
 for route in routes:
  pattern=re.sub(r':[A-Za-z]+','[^/]+',route['path'])
  if method!=route['method'] or not re.fullmatch(pattern,path):continue
  if route.get('representation')=='html':return
  if status==204:value=None
  if status>=400:
   if not isinstance(value,dict):raise AssertionError('Expected typed API error')
   name=route['error']
  else:name=route['response']
  validator=Draft202012Validator(schema|{'$ref':'#/$defs/'+name},format_checker=FormatChecker())
  errors=list(validator.iter_errors(value))
  if errors:raise AssertionError(method+' '+path+' '+str(status)+' schema: '+'; '.join(str(e.json_path)+': '+e.message for e in errors))
  return
