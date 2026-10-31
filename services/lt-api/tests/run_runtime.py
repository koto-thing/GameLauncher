import subprocess,sys,os
sys.stdout.reconfigure(encoding='utf-8',errors='replace')
os.environ['PYTHONIOENCODING']='utf-8'
from pathlib import Path
files=['public_guard_test.py','runtime_test.py','applicant_runtime_test.py','automatic_approval_runtime_test.py','schedule_rules_runtime_test.py','automation_runtime_test.py','monitor_runtime_test.py','operator_runtime_test.py','review_runtime_test.py','title_runtime_test.py','maintenance_runtime_test.py','privacy_runtime_test.py','events_runtime_test.py','operations_runtime_test.py','mixed_race_runtime_test.py','lifecycle_runtime_test.py','auth_clock_runtime_test.py','mail_runtime_test.py','email_change_runtime_test.py']
sys.path.insert(0,'tests')
from applicant_runtime_test import sql
sql("UPDATE lt_mail_mode SET mode='fake' WHERE id=1")
logs=[]
for name in files:
 r=subprocess.run([sys.executable,'tests/'+name,'-v'],capture_output=True,text=True,encoding='utf-8',errors='replace')
 logs.append(name+'\n'+r.stdout+r.stderr)
 print(name+(': PASS' if r.returncode==0 else ': FAIL'),flush=True)
 if r.returncode:
  Path('test-results.txt').write_text('\n'.join(logs),encoding='utf-8');print(r.stdout+r.stderr);sys.exit(r.returncode)
Path('test-results.txt').write_text('\n'.join(logs),encoding='utf-8')
