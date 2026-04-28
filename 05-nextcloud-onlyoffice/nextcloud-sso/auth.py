#!/usr/bin/env python3
"""
OWI JWT Token 검증 서비스 for Nextcloud SSO
nginx auth_request에서 호출하여 OWI 로그인 사용자를 Nextcloud에 자동 로그인
"""
import os
import jwt
import logging
from flask import Flask, request, Response

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# OWI JWT Secret (환경변수에서 로드)
JWT_SECRET = os.environ.get('WEBUI_SECRET_KEY', '')

@app.route('/auth')
def auth():
    """
    OWI 토큰 검증 엔드포인트
    - 성공: 200 + X-Auth-User 헤더에 이메일 반환
    - 실패: 401
    """
    # 쿠키에서 token 추출
    token = request.cookies.get('token')

    if not token:
        # Authorization 헤더에서도 확인
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            token = auth_header[7:]

    if not token:
        logger.debug("No token found")
        return Response(status=401)

    try:
        # JWT 검증
        payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
        user_id = payload.get('id')
        email = payload.get('email') or payload.get('sub')

        # OWI 토큰은 id만 포함, email은 API로 조회 필요
        if not email and user_id:
            import urllib.request
            import json as json_lib
            try:
                req = urllib.request.Request(
                    'http://192.168.0.201:8080/api/v1/auths/',
                    headers={'Authorization': f'Bearer {token}'}
                )
                with urllib.request.urlopen(req, timeout=5) as resp:
                    user_data = json_lib.loads(resp.read())
                    email = user_data.get('email')
            except Exception as e:
                logger.warning(f"Failed to fetch user info: {e}")

        if not email:
            logger.warning("Token has no email/sub field and user lookup failed")
            return Response(status=401)

        # 성공: X-Auth-User 헤더에 이메일 반환
        logger.info(f"Auth success: {email}")
        resp = Response(status=200)
        resp.headers['X-Auth-User'] = email
        resp.headers['X-Auth-Email'] = email
        return resp

    except jwt.ExpiredSignatureError:
        logger.debug("Token expired")
        return Response(status=401)
    except jwt.InvalidTokenError as e:
        logger.debug(f"Invalid token: {e}")
        return Response(status=401)
    except Exception as e:
        logger.error(f"Auth error: {e}")
        return Response(status=500)

@app.route('/health')
def health():
    return 'ok'

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8099)
