#!/usr/bin/env python3
"""
流光绘卷 v6 本地开发服务器（含 AI API 代理）

解决阿里云百炼 API 的 CORS 跨域问题：
- 静态文件直接服务（HTML/CSS/JS）
- /api/ai/* 请求自动转发到 AI API，添加 CORS 响应头

用法：
    python server.py
    然后访问 http://localhost:8080/lizi.html

默认端口：8080
可通过环境变量 PORT 或命令行参数指定：
    python server.py 8081
"""

import os
import sys
import json
import urllib.request
import urllib.error
from http.server import HTTPServer, BaseHTTPRequestHandler


AI_API_BASE = os.environ.get('AI_API_BASE', 'https://ws-3coh8ayi84uf5ljj.cn-beijing.maas.aliyuncs.com/compatible-mode/v1')


class RequestHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/api/ai/'):
            self._proxy_ai('GET')
        else:
            self._serve_file()

    def do_POST(self):
        if self.path.startswith('/api/ai/'):
            self._proxy_ai('POST')
        else:
            self._serve_file()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept')
        self.end_headers()

    def _serve_file(self):
        path = self.path.lstrip('/')
        if not path:
            path = 'lizi.html'

        full_path = os.path.join(os.getcwd(), path)

        if not os.path.isfile(full_path):
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
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
        }
        content_type = content_types.get(ext, 'application/octet-stream')

        try:
            with open(full_path, 'rb') as f:
                content = f.read()
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', len(content))
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_response(500)
            self.end_headers()

    def _proxy_ai(self, method):
        ai_path = self.path[7:]
        ai_url = AI_API_BASE + ai_path

        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length) if content_length > 0 else b''

        req = urllib.request.Request(ai_url, data=body, method=method)

        forward_headers = ['Content-Type', 'Authorization', 'Accept', 'User-Agent']
        for h in forward_headers:
            if h in self.headers:
                req.add_header(h, self.headers[h])

        try:
            with urllib.request.urlopen(req, timeout=35) as resp:
                resp_body = resp.read()
                resp_headers = resp.info()

                self.send_response(resp.status)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept')

                for key in ['Content-Type', 'Content-Length', 'Date']:
                    if key in resp_headers:
                        self.send_header(key, resp_headers[key])

                self.end_headers()
                self.wfile.write(resp_body)

        except urllib.error.HTTPError as e:
            resp_body = e.read()
            self.send_response(e.code)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(resp_body)
        except urllib.error.URLError as e:
            self.send_response(502)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())
        except Exception as e:
            self.send_response(500)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    def log_message(self, format, *args):
        print(f"[{self.address_string()}] {format % args}")


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get('PORT', 8080))
    host = '127.0.0.1'

    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    server = HTTPServer((host, port), RequestHandler)
    print(f"✨ 流光绘卷 v6 开发服务器启动")
    print(f"地址：http://{host}:{port}/lizi.html")
    print(f"AI API 代理：/api/ai/* -> {AI_API_BASE}")
    print(f"按 Ctrl+C 停止服务器")
    print()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务器已停止")


if __name__ == '__main__':
    main()
