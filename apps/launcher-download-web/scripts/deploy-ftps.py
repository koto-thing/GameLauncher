import ftplib, os, sys, json, ssl
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

# 接続先と公開先は環境変数から読み、認証情報をソースへ残さない
raw=os.environ['FTP_SERVER']
u=urlsplit(raw if '://' in raw else 'ftps://'+raw)
folder=os.environ['PUBLIC_FOLDER'].strip().rstrip('/')

# 公開先の親ディレクトリ移動を拒否し、意図しない領域への配布を防ぐ
if not folder or '..' in folder.split('/') or folder == '/': raise SystemExit('Unsafe publication folder')
if u.scheme not in ('ftp', 'ftps'): raise SystemExit('Explicit FTPS on port 21 is required')

# TLS接続と暗号化転送を強制し、ログイン後のデータ転送も保護する
ftp=ftplib.FTP_TLS(timeout=45, context=ssl.create_default_context())
ftp.connect(u.hostname,u.port or 21)
ftp.login(os.environ['FTP_USERNAME'],os.environ['FTP_PASSWORD'])
ftp.prot_p()
ftp.cwd('/')
ftp.cwd(folder)
print('FTPS connected. Target directory entries:')
print(json.dumps(ftp.nlst(),ensure_ascii=False))

# 確認だけの実行では公開内容を変更せず、--upload時だけdistを送る
if '--upload' in sys.argv:
    root=Path('dist').resolve()
    backup=Path('build/remote-backup') / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'); backup.mkdir(parents=True,exist_ok=True)

    # このサーバーは空のPWDを返すため、FTPルートから明示的に移動し直す
    files=sorted(p for p in root.rglob('*') if p.is_file())
    if not (root/'index.html').is_file(): raise SystemExit('Build dist/index.html first')
    files.sort(key=lambda p:p.name=='index.html')

    for p in files:
        relative=p.relative_to(root)

        # サーバーの現在位置を毎回リセットし、前ファイルの移動状態に依存しない
        ftp.cwd('/')
        ftp.cwd(folder)
        for segment in relative.parts[:-1]:
            try: ftp.mkd(segment)
            except ftplib.error_perm as e:
                if not str(e).startswith('550'): raise
            ftp.cwd(segment)

        # 既存ファイルを退避してから更新し、失敗時の復旧材料を残す
        if p.name in ftp.nlst():
            saved=backup/relative; saved.parent.mkdir(parents=True,exist_ok=True)
            with saved.open('wb') as f: ftp.retrbinary('RETR '+p.name,f.write)

        # バイナリ転送後にTLS状態を復元し、次のFTP応答を確実に読み取る
        ftp.voidcmd('TYPE I')
        with p.open('rb') as f, ftp.transfercmd('STOR '+p.name) as conn:
            while chunk:=f.read(65536): conn.sendall(chunk)
            try: conn.unwrap()
            except ConnectionResetError: pass
        ftp.voidresp()
        ftp.voidcmd('TYPE I')

        # サイズを再取得して転送途中の欠落を検出する
        if ftp.size(p.name)!=p.stat().st_size: raise RuntimeError('Size mismatch: '+str(relative))
        print('Uploaded '+relative.as_posix())

ftp.quit()
