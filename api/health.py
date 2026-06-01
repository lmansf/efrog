from http.server import BaseHTTPRequestHandler
import json

LABEL_CLASSES = ['cane_toad', 'oak_toad', 'southern_toad']

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({'status': 'ok', 'classes': LABEL_CLASSES}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass
