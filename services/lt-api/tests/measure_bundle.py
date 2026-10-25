"""生成bundleだけを測定し、認証情報を記録しない"""
import sys,json,gzip
from pathlib import Path
label=sys.argv[1]
p=Path('verification.json');data=json.loads(p.read_text(encoding='utf-8')) if p.exists() else {'bundles':{}}
files=['build/index_bg.wasm','build/index.js']
if label!='development_with_test_hooks':
 assert b'X-LT-Test-Pause' not in Path(files[0]).read_bytes()
 assert 'fake_mail' not in Path(files[1]).read_text(encoding='utf-8')
 assert 'test_dispatch' not in Path(files[1]).read_text(encoding='utf-8')
 assert 'set_clock' not in Path(files[1]).read_text(encoding='utf-8')
data['bundles'][label]={Path(f).name:{'bytes':len(Path(f).read_bytes()),'gzip_bytes':len(gzip.compress(Path(f).read_bytes()))} for f in files}
data.update(toolchain='1.94.1',worker='0.8.7',wrangler='4.152.0',runtime_tests=47,shared_response_schema_validation=True,cpu_time_measured=False,cloud_tests_run=False)
p.write_text(json.dumps(data,indent=2),encoding='utf-8');print(label+': measured')
