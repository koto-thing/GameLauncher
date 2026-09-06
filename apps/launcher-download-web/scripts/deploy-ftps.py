import ftplib, os, sys, json, ssl
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
raw=os.environ['FTP_SERVER']
u=urlsplit(raw if '://' in raw else 'ftps://'+raw)
folder=os.environ['PUBLIC_FOLDER'].strip().rstrip('/')
if not folder or '..' in folder.split('/') or folder == '/': raise SystemExit('Unsafe publication folder')
if u.scheme not in ('ftp', 'ftps'): raise SystemExit('Explicit FTPS on port 21 is required')
ftp=ftplib.FTP_TLS(timeout=45, context=ssl.create_default_context())
ftp.connect(u.hostname,u.port or 21)
ftp.login(os.environ['FTP_USERNAME'],os.environ['FTP_PASSWORD'])
ftp.prot_p()
ftp.cwd('/')
ftp.cwd(folder)
print('FTPS connected. Target directory entries:')
print(json.dumps(ftp.nlst(),ensure_ascii=False))
if '--upload' in sys.argv:
    root=Path('dist').resolve()
    backup=Path('build/remote-backup') / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'); backup.mkdir(parents=True,exist_ok=True)
    # This server returns an empty PWD; reset from the FTP root explicitly.
    files=sorted(p for p in root.rglob('*') if p.is_file())
    if not (root/'index.html').is_file(): raise SystemExit('Build dist/index.html first')
    files.sort(key=lambda p:p.name=='index.html')
    for p in files:
        relative=p.relative_to(root)
        ftp.cwd('/')
        ftp.cwd(folder)
        for segment in relative.parts[:-1]:
            try: ftp.mkd(segment)
            except ftplib.error_perm as e:
                if not str(e).startswith('550'): raise
            ftp.cwd(segment)
        if p.name in ftp.nlst():
            saved=backup/relative; saved.parent.mkdir(parents=True,exist_ok=True)
            with saved.open('wb') as f: ftp.retrbinary('RETR '+p.name,f.write)
        ftp.voidcmd('TYPE I')
        with p.open('rb') as f, ftp.transfercmd('STOR '+p.name) as conn:
            while chunk:=f.read(65536): conn.sendall(chunk)
            try: conn.unwrap()
            except ConnectionResetError: pass
        ftp.voidresp()
        ftp.voidcmd('TYPE I')
        if ftp.size(p.name)!=p.stat().st_size: raise RuntimeError('Size mismatch: '+str(relative))
        print('Uploaded '+relative.as_posix())
ftp.quit()
