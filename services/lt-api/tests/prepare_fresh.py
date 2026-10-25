import subprocess,sys
sys.stdout.reconfigure(encoding='utf-8',errors='replace')
base=['node','node_modules/wrangler/bin/wrangler.js','d1']
commands=[base+['migrations','apply','lt-local','--local','--persist-to','.wrangler/fresh-final-settings'],base+['execute','lt-local','--local','--persist-to','.wrangler/fresh-final-settings','--file','tests/fixture.sql']]
for label,cmd in zip(['fresh migrations','fresh fixture'],commands):
 result=subprocess.run(cmd,capture_output=True,text=True,encoding='utf-8',errors='replace')
 print(label+(': PASS' if result.returncode==0 else ': FAIL'),flush=True)
 if result.returncode:print(result.stdout+result.stderr);sys.exit(result.returncode)
