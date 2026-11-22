"""立ち絵の書き出し用に静的ファイルを配信し、POST された PNG を out へ保存する"""
import http.server, pathlib, re, urllib.parse

ROOT = pathlib.Path(__file__).parent

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_POST(self):
        name = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)["name"][0]
        if not re.fullmatch(r"[a-z_]+", name):
            self.send_error(400); return
        data = self.rfile.read(int(self.headers["Content-Length"]))
        (ROOT / "out" / f"{name}.png").write_bytes(data)
        print("saved", name, len(data), flush=True)
        self.send_response(204); self.end_headers()

http.server.ThreadingHTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
