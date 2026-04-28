#!/usr/bin/env python3
"""
Nextcloud SSO 프록시
- OWI 토큰 검증
- Nextcloud 앱 비밀번호로 자동 로그인
"""
import os
import jwt
import json
import base64
import hashlib
import logging
import subprocess
import urllib.request
import urllib.parse
from flask import Flask, request, redirect, make_response, Response

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

JWT_SECRET = os.environ.get('WEBUI_SECRET_KEY', '')

# 앱 비밀번호 캐시 (email -> password)
APP_PASSWORDS = {}

def get_user_from_token(token):
    """OWI 토큰에서 사용자 정보 조회"""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
        user_id = payload.get('id')
        if not user_id:
            return None

        req = urllib.request.Request(
            'http://192.168.0.201:8080/api/v1/auths/',
            headers={'Authorization': f'Bearer {token}'}
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            user_data = json.loads(resp.read())
            return {
                'email': user_data.get('email'),
                'name': user_data.get('name')
            }
    except Exception as e:
        logger.warning(f"Token verification failed: {e}")
        return None

def get_or_create_app_password(email):
    """Nextcloud 앱 비밀번호 생성/조회"""
    if email in APP_PASSWORDS:
        return APP_PASSWORDS[email]

    # 고정 비밀번호 (사용자별로 해시 생성)
    password = f"NC_{hashlib.md5(email.encode()).hexdigest()[:12]}!Aa"
    APP_PASSWORDS[email] = password
    return password

@app.route('/auth')
def auth():
    """nginx auth_request용"""
    token = request.cookies.get('token')
    if not token:
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            token = auth_header[7:]

    if not token:
        return '', 401

    user = get_user_from_token(token)
    if not user or not user.get('email'):
        return '', 401

    email = user['email']
    password = get_or_create_app_password(email)

    # Basic Auth 헤더 생성
    credentials = base64.b64encode(f"{email}:{password}".encode()).decode()

    resp = make_response('', 200)
    resp.headers['X-Auth-User'] = email
    resp.headers['X-Auth-Credentials'] = f"Basic {credentials}"
    return resp

@app.route('/login')
def login():
    """Nextcloud 자동 로그인"""
    token = request.cookies.get('token')
    if not token:
        return redirect('/?nextcloud=1')

    user = get_user_from_token(token)
    if not user or not user.get('email'):
        return redirect('/?nextcloud=1')

    email = user['email']
    password = get_or_create_app_password(email)

    # Nextcloud 로그인 페이지로 리다이렉트 (자동 로그인)
    credentials = base64.b64encode(f"{email}:{password}".encode()).decode()

    resp = make_response(redirect('/nextcloud/'))
    resp.headers['Authorization'] = f'Basic {credentials}'
    return resp

@app.route('/health')
def health():
    return 'ok'

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8099)
