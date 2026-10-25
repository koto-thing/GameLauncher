"""localhostのGET wall timeのみを測定する。CPU時間とは扱わない"""
import urllib.request,time,json,statistics
from pathlib import Path
endpoints={'public_list':'http://127.0.0.1:18877/api/lt/v1/events','public_detail':'http://127.0.0.1:18877/api/lt/v1/events/open','anonymous_session':'http://127.0.0.1:18877/api/lt/v1/auth/session','operator_page_20':'http://127.0.0.1:18878/api/lt/v1/operator/events/open/applications?limit=20'}
results={}
for label,url in endpoints.items():
 times=[];sizes=[]
 for i in range(11):
  start=time.perf_counter()
  with urllib.request.urlopen(url) as response:
   assert response.status==200
   body=response.read()
  if i:times.append((time.perf_counter()-start)*1000);sizes.append(len(body))
 results[label]={'samples':10,'median_wall_ms':round(statistics.median(times),3),'p95_wall_ms':round(sorted(times)[-1],3),'response_bytes':max(sizes)}
p=Path('verification.json');data=json.loads(p.read_text(encoding='utf-8'));data['local_wall_time']=results;p.write_text(json.dumps(data,indent=2),encoding='utf-8');print(json.dumps(results,indent=2))
