"""
rHWP Collaboration Server v3.0
CRDT 기반 실시간 동시편집을 위한 WebSocket 서버
- Operation batch 처리 (효율적인 네트워크 사용)
- 문서 전체 브로드캐스트 없음
"""
import asyncio
import json
import logging
from datetime import datetime
from typing import Dict, Set, Optional, List, Any
from dataclasses import dataclass, asdict, field
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("rhwp-collab")

app = FastAPI(title="rHWP Collaboration Server v3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@dataclass
class User:
    """편집 참여자"""
    user_id: str
    user_name: str
    color: str
    crdt_site_id: str = ""
    cursor_pos: Optional[dict] = None
    last_active: str = ""

    def to_dict(self):
        return asdict(self)


@dataclass
class CRDTOperation:
    """CRDT 편집 작업"""
    type: str           # insert, delete, splitParagraph, etc.
    site_id: str        # 원본 클라이언트 식별자
    counter: int        # Lamport clock
    para_id: int        # 문단 ID
    data: dict          # 추가 데이터 (char, charIndex, etc.)
    timestamp: int = 0
    seq: int = 0        # 서버 시퀀스

    def to_dict(self):
        return {
            "type": self.type,
            "siteId": self.site_id,
            "counter": self.counter,
            "paraId": self.para_id,
            "data": self.data,
            "timestamp": self.timestamp,
            "seq": self.seq
        }


@dataclass
class DocumentSession:
    """문서 편집 세션"""
    file_id: str
    users: Dict[str, User] = field(default_factory=dict)
    connections: Dict[str, WebSocket] = field(default_factory=dict)
    operations: List[CRDTOperation] = field(default_factory=list)
    operation_seq: int = 0
    last_modified: str = ""
    last_modified_by: str = ""


sessions: Dict[str, DocumentSession] = {}

COLORS = [
    "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4",
    "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F",
    "#BB8FCE", "#85C1E9", "#F8B500", "#00CED1"
]


def get_session(file_id: str) -> DocumentSession:
    if file_id not in sessions:
        sessions[file_id] = DocumentSession(file_id=file_id)
    return sessions[file_id]


def get_user_color(session: DocumentSession) -> str:
    used_colors = {u.color for u in session.users.values()}
    for color in COLORS:
        if color not in used_colors:
            return color
    return COLORS[len(session.users) % len(COLORS)]


async def broadcast_to_session(session: DocumentSession, message: dict, exclude_id: str = None):
    """세션 내 모든 사용자에게 메시지 브로드캐스트"""
    disconnected = []
    msg_json = json.dumps(message, ensure_ascii=False)

    for ws_id, ws in session.connections.items():
        if ws_id == exclude_id:
            continue
        try:
            await ws.send_text(msg_json)
        except Exception as e:
            logger.warning(f"Send failed to {ws_id}: {e}")
            disconnected.append(ws_id)

    for ws_id in disconnected:
        await remove_user(session, ws_id)


async def remove_user(session: DocumentSession, ws_id: str):
    """사용자 제거 및 세션 정리"""
    if ws_id in session.users:
        user = session.users.pop(ws_id)
        logger.info(f"User left: {user.user_name} from file {session.file_id}")
    if ws_id in session.connections:
        del session.connections[ws_id]

    await broadcast_to_session(session, {
        "type": "user_left",
        "users": [u.to_dict() for u in session.users.values()]
    })

    # 빈 세션 정리
    if not session.users and session.file_id in sessions:
        del sessions[session.file_id]
        logger.info(f"Session closed: {session.file_id}")


def parse_operation(op_data: dict, user: User) -> CRDTOperation:
    """클라이언트 operation을 서버 CRDTOperation으로 변환"""
    return CRDTOperation(
        type=op_data.get("type", "unknown"),
        site_id=op_data.get("siteId", user.crdt_site_id or user.user_id),
        counter=op_data.get("counter", 0),
        para_id=op_data.get("paraId", 0),
        data={
            k: v for k, v in op_data.items()
            if k not in ("type", "siteId", "counter", "paraId", "timestamp", "seq")
        },
        timestamp=op_data.get("timestamp", int(datetime.now().timestamp() * 1000))
    )


@app.websocket("/ws/{file_id}")
async def websocket_endpoint(websocket: WebSocket, file_id: str):
    await websocket.accept()
    ws_id = str(id(websocket))
    session = get_session(file_id)

    logger.info(f"New connection to file {file_id}")

    try:
        # 초기 join 메시지 대기
        init_data = await websocket.receive_json()

        if init_data.get("type") != "join":
            await websocket.close(code=4000, reason="Expected join message")
            return

        user = User(
            user_id=init_data.get("userId", "anonymous"),
            user_name=init_data.get("userName", "익명"),
            color=get_user_color(session),
            crdt_site_id=init_data.get("crdtSiteId", ""),
            last_active=datetime.now().isoformat()
        )

        session.users[ws_id] = user
        session.connections[ws_id] = websocket

        logger.info(f"User joined: {user.user_name} to file {file_id} "
                   f"(crdt_site: {user.crdt_site_id[:20]}..., total: {len(session.users)})")

        # 이미 다른 사용자가 있으면 문서 동기화 필요
        need_sync = len(session.users) > 1

        # 참여 성공 응답
        await websocket.send_json({
            "type": "joined",
            "user": user.to_dict(),
            "users": [u.to_dict() for u in session.users.values()],
            "operations": [op.to_dict() for op in session.operations[-500:]],
            "lastSeq": session.operation_seq,
            "lastModified": session.last_modified,
            "lastModifiedBy": session.last_modified_by,
            "needSync": need_sync
        })

        # 다른 사용자들에게 알림
        await broadcast_to_session(session, {
            "type": "user_joined",
            "user": user.to_dict(),
            "users": [u.to_dict() for u in session.users.values()]
        }, exclude_id=ws_id)

        # 새 사용자가 들어왔고 기존 사용자가 있으면, 기존 사용자에게 문서 전송 요청
        if need_sync:
            # 첫 번째 사용자(호스트)에게 문서 전송 요청
            for other_ws_id, other_ws in session.connections.items():
                if other_ws_id != ws_id:
                    try:
                        await other_ws.send_json({
                            "type": "sync_request",
                            "targetUserId": user.user_id,
                            "targetWsId": ws_id
                        })
                        logger.info(f"Requesting sync from existing user for {user.user_name}")
                    except:
                        pass
                    break  # 첫 번째 사용자에게만 요청

        # 메시지 수신 루프
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")
            user.last_active = datetime.now().isoformat()

            if msg_type == "operations":
                # CRDT operation batch 처리 (핵심!)
                incoming_ops = data.get("operations", [])
                if not incoming_ops:
                    continue

                processed_ops = []
                for op_data in incoming_ops:
                    session.operation_seq += 1
                    op = parse_operation(op_data, user)
                    op.seq = session.operation_seq
                    session.operations.append(op)
                    processed_ops.append(op)

                # 히스토리 크기 제한 (최근 2000개만 유지)
                if len(session.operations) > 2000:
                    session.operations = session.operations[-2000:]

                session.last_modified = datetime.now().isoformat()
                session.last_modified_by = user.user_name

                # 다른 클라이언트들에게 브로드캐스트
                await broadcast_to_session(session, {
                    "type": "operations",
                    "userId": user.user_id,
                    "userName": user.user_name,
                    "operations": [op.to_dict() for op in processed_ops],
                    "lastSeq": session.operation_seq
                }, exclude_id=ws_id)

                logger.debug(f"Operations from {user.user_name}: {len(processed_ops)} ops, "
                           f"seq={session.operation_seq}")

            elif msg_type == "cursor":
                # 커서 위치 공유
                user.cursor_pos = data.get("position")
                await broadcast_to_session(session, {
                    "type": "cursor",
                    "userId": user.user_id,
                    "userName": user.user_name,
                    "color": user.color,
                    "position": user.cursor_pos
                }, exclude_id=ws_id)

            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})

            elif msg_type == "request_sync":
                # 동기화 요청 시 전체 operation 히스토리 전송
                await websocket.send_json({
                    "type": "sync_response",
                    "operations": [op.to_dict() for op in session.operations],
                    "lastSeq": session.operation_seq
                })
                logger.info(f"Sync requested by {user.user_name}: {len(session.operations)} ops")

            elif msg_type == "sync_document":
                # 기존 사용자가 새 사용자에게 문서 전송
                target_ws_id = data.get("targetWsId")
                doc_data = data.get("document")  # base64 encoded
                if target_ws_id and target_ws_id in session.connections:
                    try:
                        await session.connections[target_ws_id].send_json({
                            "type": "load_document",
                            "document": doc_data,
                            "fromUser": user.user_name
                        })
                        logger.info(f"Document synced from {user.user_name} to target")
                    except Exception as e:
                        logger.error(f"Failed to send document: {e}")

            elif msg_type == "full_sync":
                # 전체 문서 동기화 (폴링 방식)
                doc_data = data.get("document")
                if doc_data:
                    session.last_modified = datetime.now().isoformat()
                    session.last_modified_by = user.user_name
                    # 다른 모든 사용자에게 브로드캐스트
                    await broadcast_to_session(session, {
                        "type": "full_sync",
                        "document": doc_data,
                        "userId": user.user_id,
                        "userName": user.user_name
                    }, exclude_id=ws_id)
                    logger.info(f"Full sync from {user.user_name}")

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {ws_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        await remove_user(session, ws_id)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "version": "3.0",
        "mode": "CRDT",
        "sessions": len(sessions),
        "total_users": sum(len(s.users) for s in sessions.values()),
        "total_operations": sum(len(s.operations) for s in sessions.values())
    }


@app.get("/sessions")
async def list_sessions():
    return {
        "sessions": [
            {
                "fileId": s.file_id,
                "userCount": len(s.users),
                "users": [u.to_dict() for u in s.users.values()],
                "operationCount": len(s.operations),
                "lastSeq": s.operation_seq,
                "lastModified": s.last_modified
            }
            for s in sessions.values()
        ]
    }


@app.get("/sessions/{file_id}/operations")
async def get_session_operations(file_id: str, since_seq: int = 0):
    """특정 시퀀스 이후의 operation만 조회 (재연결 시 동기화용)"""
    if file_id not in sessions:
        return {"operations": [], "lastSeq": 0}

    session = sessions[file_id]
    ops = [op.to_dict() for op in session.operations if op.seq > since_seq]
    return {
        "operations": ops,
        "lastSeq": session.operation_seq
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8765)
