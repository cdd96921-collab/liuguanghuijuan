#!/usr/bin/env python3
"""
流光绘卷 v7 本地开发服务器（含 AI API 代理）
"""

import os
import sys
import json
import urllib.request
import urllib.error
from http.server import HTTPServer, BaseHTTPRequestHandler

AI_API_BASE = 'https://ws-3coh8ayi84uf5ljj.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
AI_API_KEY = 'sk-ws-H.RXYLELH.3pmT.MEYCIQD1OV_kzWp_d9tnzHnGWNcMzzf237BK8F6CE5cEtykVJAIhAImLOqipzxlMGZXkOgx3OXehEYV6cYEHrnt_EGNG7FUu'


class RequestHandler(BaseHTTPRequestHandler):
    def _send_cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept')

    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors()
        self.end_headers()

    def do_GET(self):
        print(f"GET: {self.path}")
        if self.path == '/api/ai' or self.path.startswith('/api/ai/'):
            self._proxy_ai('GET')
        else:
            self._serve_file()

    def do_POST(self):
        print(f"POST: {self.path}")
        if self.path == '/api/ai' or self.path.startswith('/api/ai/'):
            self._proxy_ai('POST')
        else:
            self._serve_file()

    def _serve_file(self):
        path = self.path.lstrip('/')
        if not path:
            path = 'lizi.html'
        
        full_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), path)
        print(f"Serving file: {full_path}")
        
        if not os.path.isfile(full_path):
            print(f"File not found: {full_path}")
            self.send_response(404)
            self.end_headers()
            return

        ext = os.path.splitext(path)[1].lower()
        content_types = {
            '.html': 'text/html; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon',
        }
        content_type = content_types.get(ext, 'application/octet-stream')

        with open(full_path, 'rb') as f:
            content = f.read()
        
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', len(content))
        self.end_headers()
        self.wfile.write(content)

    def _proxy_ai(self, method):
        ai_path = self.path[7:]
        ai_url = AI_API_BASE + ai_path
        
        print(f"Proxying to: {ai_url}")
        
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length) if content_length > 0 else b''
        
        req = urllib.request.Request(ai_url, data=body, method=method)
        req.add_header('Content-Type', 'application/json')
        req.add_header('Authorization', f'Bearer {AI_API_KEY}')
        
        for h in ['Accept', 'User-Agent']:
            if h in self.headers:
                req.add_header(h, self.headers[h])
        
        print(f"=== AI Proxy Debug ===")
        print(f"Request path: {self.path}")
        print(f"AI_API_BASE: {AI_API_BASE}")
        print(f"AI_API_KEY ending: ****{AI_API_KEY[-8:]}")
        print(f"Full AI URL: {ai_url}")
        
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                resp_body = resp.read()
                self.send_response(resp.status)
                self._send_cors()
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(resp_body)
                print(f"Proxy response: {resp.status}")
        except urllib.error.HTTPError as e:
            resp_body = e.read()
            self.send_response(e.code)
            self._send_cors()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(resp_body)
            print(f"Proxy error: {e.code}")
        except Exception as e:
            self.send_response(500)
            self._send_cors()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())
            print(f"Proxy exception: {e}")

    def log_message(self, format, *args):
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    server = HTTPServer(('127.0.0.1', port), RequestHandler)
    print(f"✨ 流光绘卷 V7 服务器启动")
    print(f"地址：http://127.0.0.1:{port}/lizi.html")
    print(f"AI代理：/api/ai -> {AI_API_BASE}/chat/completions")
    print(f"按 Ctrl+C 停止")
    server.serve_forever()


if __name__ == '__main__':
    main()
