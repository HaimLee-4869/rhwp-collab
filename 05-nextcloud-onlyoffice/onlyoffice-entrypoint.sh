#!/bin/bash
# OnlyOffice Document Server 시작 전 PostgreSQL SSL 비활성화

# PostgreSQL SSL 비활성화
if [ -f /etc/postgresql/14/main/postgresql.conf ]; then
    sed -i 's/ssl = on/ssl = off/' /etc/postgresql/14/main/postgresql.conf 2>/dev/null || true
fi

# 원본 entrypoint 실행
exec /app/ds/run-document-server.sh "$@"
