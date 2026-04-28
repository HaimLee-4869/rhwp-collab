/**
 * rHWP 실시간 협업 모듈
 *
 * WebSocket을 통해 편집 명령을 동기화합니다.
 * - 로컬 명령 → 서버 브로드캐스트
 * - 원격 명령 수신 → 로컬 적용
 * - 커서 위치 공유
 */
import type { WasmBridge } from './wasm-bridge';
import type { EventBus } from './event-bus';
import type { DocumentPosition } from './types';
import {
  InsertTextCommand,
  DeleteTextCommand,
  InsertLineBreakCommand,
  InsertTabCommand,
  SplitParagraphCommand,
  MergeParagraphCommand,
  type EditCommand,
} from '@/engine/command';

export interface CollabUser {
  userId: string;
  userName: string;
  color: string;
  cursor?: DocumentPosition;
}

export interface CollabOperation {
  type: string;
  userId: string;
  timestamp: number;
  data: any;
}

export interface CollabConfig {
  serverUrl: string;
  fileId: string;
  userId: string;
  userName: string;
}

type MessageHandler = (data: any) => void;

export class CollaborationManager {
  private ws: WebSocket | null = null;
  private config: CollabConfig | null = null;
  private wasm: WasmBridge;
  private eventBus: EventBus;
  private users: Map<string, CollabUser> = new Map();
  private currentUser: CollabUser | null = null;
  private isApplyingRemote = false;
  private reconnectTimer: number | null = null;
  private messageHandlers: Map<string, MessageHandler[]> = new Map();

  constructor(wasm: WasmBridge, eventBus: EventBus) {
    this.wasm = wasm;
    this.eventBus = eventBus;
  }

  /** 협업 세션 연결 */
  connect(config: CollabConfig): Promise<void> {
    this.config = config;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(`${config.serverUrl}/${config.fileId}`);

        this.ws.onopen = () => {
          console.log('[Collab] 연결됨');
          // 세션 참여
          this.send({
            type: 'join',
            userId: config.userId,
            userName: config.userName,
          });
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
          } catch (e) {
            console.error('[Collab] 메시지 파싱 오류:', e);
          }
        };

        this.ws.onclose = () => {
          console.log('[Collab] 연결 종료');
          this.scheduleReconnect();
        };

        this.ws.onerror = (err) => {
          console.error('[Collab] 에러:', err);
          reject(err);
        };

      } catch (e) {
        reject(e);
      }
    });
  }

  /** 연결 해제 */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.users.clear();
    this.currentUser = null;
  }

  /** 재연결 스케줄 */
  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.config) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.config) {
        console.log('[Collab] 재연결 시도...');
        this.connect(this.config).catch(() => {
          this.scheduleReconnect();
        });
      }
    }, 3000);
  }

  /** 메시지 전송 */
  private send(data: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  /** 수신 메시지 처리 */
  private handleMessage(data: any): void {
    const type = data.type;

    switch (type) {
      case 'joined':
        this.currentUser = data.user;
        this.users.clear();
        for (const u of data.users) {
          this.users.set(u.userId, u);
        }
        this.eventBus.emit('collab-users-changed', this.getUsers());
        console.log('[Collab] 참여 완료:', this.currentUser?.userName);
        break;

      case 'user_joined':
        this.users.set(data.user.userId, data.user);
        this.eventBus.emit('collab-users-changed', this.getUsers());
        this.eventBus.emit('collab-user-joined', data.user);
        break;

      case 'user_left':
        this.users.clear();
        for (const u of data.users) {
          this.users.set(u.userId, u);
        }
        this.eventBus.emit('collab-users-changed', this.getUsers());
        break;

      case 'operation':
        // 원격 편집 작업 수신
        if (data.userId !== this.currentUser?.userId) {
          this.applyRemoteOperation(data.operation);
        }
        break;

      case 'cursor':
        // 원격 커서 위치 업데이트
        const user = this.users.get(data.userId);
        if (user) {
          user.cursor = data.position;
          this.eventBus.emit('collab-cursor-changed', data);
        }
        break;

      case 'pong':
        // 핑 응답
        break;
    }

    // 커스텀 핸들러 호출
    const handlers = this.messageHandlers.get(type);
    if (handlers) {
      handlers.forEach(h => h(data));
    }
  }

  /** 로컬 편집 명령 브로드캐스트 */
  broadcastOperation(command: EditCommand): void {
    if (this.isApplyingRemote) return; // 원격 명령 적용 중이면 무시

    const operation = this.serializeCommand(command);
    if (!operation) return;

    this.send({
      type: 'operation',
      operation,
    });
  }

  /** 커서 위치 브로드캐스트 */
  broadcastCursor(position: DocumentPosition): void {
    this.send({
      type: 'cursor',
      position,
    });
  }

  /** 원격 편집 작업 적용 */
  private applyRemoteOperation(operation: CollabOperation): void {
    this.isApplyingRemote = true;

    try {
      const command = this.deserializeCommand(operation);
      if (command) {
        // 직접 실행 (히스토리에 기록하지 않음)
        command.execute(this.wasm);
        this.eventBus.emit('document-changed');
        this.eventBus.emit('collab-remote-operation', operation);
      }
    } catch (e) {
      console.error('[Collab] 원격 작업 적용 실패:', e);
    } finally {
      this.isApplyingRemote = false;
    }
  }

  /** EditCommand → 직렬화 가능한 객체 */
  private serializeCommand(cmd: EditCommand): CollabOperation | null {
    const base = {
      userId: this.currentUser?.userId ?? '',
      timestamp: cmd.timestamp,
    };

    if (cmd instanceof InsertTextCommand) {
      return {
        ...base,
        type: 'insertText',
        data: {
          position: (cmd as any).position,
          text: (cmd as any).text,
        },
      };
    }

    if (cmd instanceof DeleteTextCommand) {
      return {
        ...base,
        type: 'deleteText',
        data: {
          position: (cmd as any).position,
          count: (cmd as any).count,
          direction: (cmd as any).direction,
        },
      };
    }

    if (cmd instanceof InsertLineBreakCommand) {
      return {
        ...base,
        type: 'insertLineBreak',
        data: {
          position: (cmd as any).position,
        },
      };
    }

    if (cmd instanceof InsertTabCommand) {
      return {
        ...base,
        type: 'insertTab',
        data: {
          position: (cmd as any).position,
        },
      };
    }

    if (cmd instanceof SplitParagraphCommand) {
      return {
        ...base,
        type: 'splitParagraph',
        data: {
          position: (cmd as any).position,
        },
      };
    }

    if (cmd instanceof MergeParagraphCommand) {
      return {
        ...base,
        type: 'mergeParagraph',
        data: {
          position: (cmd as any).position,
        },
      };
    }

    // 기타 명령은 스냅샷 동기화로 처리
    console.warn('[Collab] 지원하지 않는 명령 유형:', cmd.type);
    return null;
  }

  /** 직렬화된 객체 → EditCommand */
  private deserializeCommand(op: CollabOperation): EditCommand | null {
    switch (op.type) {
      case 'insertText':
        return new InsertTextCommand(op.data.position, op.data.text, op.timestamp);

      case 'deleteText':
        return new DeleteTextCommand(
          op.data.position, op.data.count, op.data.direction,
          undefined, op.timestamp
        );

      case 'insertLineBreak':
        return new InsertLineBreakCommand(op.data.position);

      case 'insertTab':
        return new InsertTabCommand(op.data.position);

      case 'splitParagraph':
        return new SplitParagraphCommand(op.data.position);

      case 'mergeParagraph':
        return new MergeParagraphCommand(op.data.position);

      default:
        console.warn('[Collab] 알 수 없는 작업 유형:', op.type);
        return null;
    }
  }

  /** 현재 참여자 목록 */
  getUsers(): CollabUser[] {
    return Array.from(this.users.values());
  }

  /** 현재 사용자 */
  getCurrentUser(): CollabUser | null {
    return this.currentUser;
  }

  /** 연결 상태 */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** 원격 작업 적용 중인지 */
  isApplyingRemoteOperation(): boolean {
    return this.isApplyingRemote;
  }

  /** 메시지 핸들러 등록 */
  on(type: string, handler: MessageHandler): () => void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, []);
    }
    this.messageHandlers.get(type)!.push(handler);
    return () => {
      const handlers = this.messageHandlers.get(type);
      if (handlers) {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      }
    };
  }
}

/** 전역 CollaborationManager 인스턴스 */
let globalCollabManager: CollaborationManager | null = null;

export function getCollaborationManager(): CollaborationManager | null {
  return globalCollabManager;
}

export function initCollaborationManager(wasm: WasmBridge, eventBus: EventBus): CollaborationManager {
  globalCollabManager = new CollaborationManager(wasm, eventBus);
  return globalCollabManager;
}
