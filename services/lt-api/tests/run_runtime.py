import subprocess,sys,os
sys.stdout.reconfigure(encoding='utf-8',errors='replace')
os.environ['PYTHONIOENCODING']='utf-8'
from pathlib import Path
files=['public_guard_test.py','runtime_test.py','applicant_runtime_test.py','operator_runtime_test.py','review_runtime_test.py','maintenance_runtime_test.py','privacy_runtime_test.py','events_runtime_test.py']
logs=[]
for name in files:
 r=subprocess.run([sys.executable,'tests/'+name,'-v'],capture_output=True,text=True,encoding='utf-8',errors='replace')
 logs.append(name+'\n'+r.stdout+r.stderr)
 print(name+(': PASS' if r.returncode==0 else ': FAIL'),flush=True)
 if r.returncode:
  Path('test-results.txt').write_text('\n'.join(logs),encoding='utf-8');print(r.stdout+r.stderr);sys.exit(r.returncode)
Path('test-results.txt').write_text('\n'.join(logs),encoding='utf-8')
