import subprocess,sys,uuid
sys.stdout.reconfigure(encoding='utf-8',errors='replace')
target='.wrangler/fresh-validation-'+uuid.uuid4().hex
print(target,flush=True)
base=['node','node_modules/wrangler/bin/wrangler.js','d1']
commands=[base+['migrations','apply','lt-local','--local','--persist-to',target],base+['execute','lt-local','--local','--persist-to',target,'--file','tests/fixture.sql']]
for label,cmd in zip(['fresh migrations','fresh fixture'],commands):
 result=subprocess.run(cmd,capture_output=True,text=True,encoding='utf-8',errors='replace')
 print(label+(': PASS' if result.returncode==0 else ': FAIL'),flush=True)
 if result.returncode:print(result.stdout+result.stderr);sys.exit(result.returncode)

result=subprocess.run(base+['execute','lt-local','--local','--persist-to',target,'--command','SELECT mode FROM lt_mail_mode WHERE id=1','--json'],capture_output=True,text=True,encoding='utf-8',errors='replace')
import json
assert result.returncode==0 and json.loads(result.stdout)[0]['results']==[{'mode':'disabled'}], 'Fresh mail mode must be disabled'
print('fresh mail mode disabled: PASS',flush=True)
