import unittest,json,urllib.request,urllib.error,subprocess,uuid,concurrent.futures
from schema_assertions import assert_response
BASE='http://127.0.0.1:8787'
def sql(command):
 p=subprocess.run(['node','node_modules/wrangler/bin/wrangler.js','d1','execute','lt-local','--local','--command',command,'--json'],capture_output=True,encoding='utf-8',check=True)
 return json.loads(p.stdout)[0]['results']
def request(path,data=None,cookie=None,method=None,origin=BASE):
 headers={'Origin':origin,'X-LT-CSRF':'1','Content-Type':'application/json'}
 if cookie:headers['Cookie']=cookie
 req=urllib.request.Request(BASE+path,data=None if data is None else json.dumps(data).encode(),headers=headers,method=method)
 try:r=urllib.request.urlopen(req)
 except urllib.error.HTTPError as e:r=e
 raw=r.read();value=json.loads(raw) if raw and r.headers.get('Content-Type','').startswith('application/json') else raw.decode()
 r.close()
 assert_response(path,req.get_method(),r.status,value)
 return r.status,value,r.headers
def mail(email):
 req=urllib.request.Request('http://127.0.0.1:8788/test/fake-mail',data=email.encode(),headers={'Content-Type':'text/plain'},method='POST')
 with urllib.request.urlopen(req) as response:return json.load(response)['confirmationUrl']

class ApplicantRuntime(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  sql("INSERT INTO lt_recruitment(event_id,opens,closes,capacity,reserved) VALUES('open',0,9999999999999,20,0) ON CONFLICT DO NOTHING")
 def login(self):
  email=uuid.uuid4().hex+'@example.invalid'
  self.assertEqual(request('/api/lt/v1/auth/email',{'email':email})[0],202)
  link=mail(email)
  token=link.split('token=')[1]
  self.assertEqual(request('/auth/verify?token='+token)[0],200)
  status,data,headers=request('/api/lt/v1/auth/verify',{'token':token})
  self.assertEqual(status,200)
  self.assertIn('HttpOnly',headers['Set-Cookie']);self.assertIn('Secure',headers['Set-Cookie']);self.assertNotIn('Domain=',headers['Set-Cookie'])
  self.assertEqual(request('/api/lt/v1/auth/verify',{'token':token})[0],400)
  return headers['Set-Cookie'].split(';')[0],email
 def payload(self):return {'eventId':'open','operationId':uuid.uuid4().hex,'content':{'title':'架空','abstract':'試験','speakers':[{'displayName':'試験者'}]},'materialUrl':'https://example.invalid/slides'}
 def test_submit_list_edit_idor_csrf(self):
  cookie,email=self.login();other,_=self.login();p=self.payload()
  self.assertEqual(request('/api/lt/v1/auth/session',cookie=cookie)[0],200)
  self.assertIsNotNone(request('/api/lt/v1/auth/session',cookie=cookie)[1]);self.assertIsNone(request('/api/lt/v1/auth/session')[1])
  self.assertEqual(request('/api/lt/v1/applications',p,cookie,origin='https://evil.invalid')[0],403)
  status,dto,_=request('/api/lt/v1/applications',p,cookie);self.assertEqual(status,200);id=dto['id']
  self.assertEqual(request('/api/lt/v1/applications',p,cookie)[1],dto)
  p['operationId']=uuid.uuid4().hex;self.assertEqual(request('/api/lt/v1/applications',p,cookie)[0],409)
  self.assertEqual(request('/api/lt/v1/applications/'+id,cookie=other)[0],404)
  self.assertEqual(len(request('/api/lt/v1/applications',cookie=cookie)[1]['items']),1)
  edit={'expectedVersion':1,'operationId':uuid.uuid4().hex,'data':{'content':p['content']|{'title':'変更'},'materialUrl':p['materialUrl']}}
  self.assertEqual(request('/api/lt/v1/applications/'+id,edit,other,'PATCH')[0],404)
  self.assertEqual(request('/api/lt/v1/applications/'+id,edit,cookie,'PATCH')[1]['version'],2)
  edit['operationId']=uuid.uuid4().hex;self.assertEqual(request('/api/lt/v1/applications/'+id,edit,cookie,'PATCH')[0],409)
  self.assertEqual(request('/api/lt/v1/auth/logout',{},cookie)[0],204)
  self.assertEqual(request('/api/lt/v1/applications',cookie=cookie)[0],401)
 def test_expired_token_and_session(self):
  cookie,email=self.login();sql("UPDATE lt_auth_tokens SET session_expires=0 WHERE email='"+email+"'")
  self.assertIsNone(request('/api/lt/v1/auth/session',cookie=cookie)[1])
  request('/api/lt/v1/auth/email',{'email':email});link=mail(email);sql("UPDATE lt_auth_tokens SET expires=0 WHERE email='"+email+"'")
  self.assertEqual(request('/api/lt/v1/auth/verify',{'token':link.split('token=')[1]})[0],400)
 def test_simultaneous_duplicate(self):
  cookie,_=self.login();payloads=[self.payload(),self.payload()]
  with concurrent.futures.ThreadPoolExecutor() as pool: statuses=list(pool.map(lambda p:request('/api/lt/v1/applications',p,cookie)[0],payloads))
  self.assertEqual(sorted(statuses),[200,409])
 def test_schema_and_closed(self):
  cookie,_=self.login();p=self.payload();p['materialUrl']='javascript:alert(1)';self.assertEqual(request('/api/lt/v1/applications',p,cookie)[0],422)
  p=self.payload();p['content']['private']='x';self.assertEqual(request('/api/lt/v1/applications',p,cookie)[0],422)
  p=self.payload();p['eventId']='cancelled';self.assertEqual(request('/api/lt/v1/applications',p,cookie)[0],409)
 def test_large_json_rejected_for_known_and_chunked_length(self):
  cookie,_=self.login();payload=self.payload();payload['content']['abstract']='a'*70000
  raw=json.dumps(payload).encode()
  for body in [raw,iter([raw[:32768],raw[32768:65536],raw[65536:]])]:
   req=urllib.request.Request(BASE+'/api/lt/v1/applications',data=body,headers={'Origin':BASE,'X-LT-CSRF':'1','Content-Type':'application/json','Cookie':cookie},method='POST')
   with self.assertRaises(urllib.error.HTTPError) as ctx:urllib.request.urlopen(req)
   self.assertEqual(ctx.exception.code,422);ctx.exception.close()
 def test_concurrent_same_operation_returns_one_existing_result(self):
  cookie,_=self.login();body=self.payload()
  with concurrent.futures.ThreadPoolExecutor() as pool:results=list(pool.map(lambda _:request('/api/lt/v1/applications',body,cookie),range(2)))
  self.assertEqual([r[0] for r in results],[200,200]);self.assertEqual(results[0][1],results[1][1])
  self.assertEqual(sql("SELECT count(*) AS n FROM lt_outbox WHERE kind='submitted' AND application_id='"+results[0][1]['id']+"'")[0]['n'],1)
if __name__=='__main__':unittest.main()
