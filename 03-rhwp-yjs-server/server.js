/**
 * rHWP Yjs WebSocket Server
 * 여러 사용자의 동시 편집을 CRDT(Yjs)로 동기화
 */
const WebSocket = require('ws')
const http = require('http')
const { setupWSConnection } = require('y-websocket/bin/utils')

const host = process.env.HOST || '0.0.0.0'
const port = parseInt(process.env.PORT || '1234')

const server = http.createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({
      status: 'ok',
      service: 'rhwp-yjs',
      version: '1.0.0'
    }))
    return
  }
  response.writeHead(200, { 'Content-Type': 'text/plain' })
  response.end('rHWP Yjs Server - OK\n')
})

const wss = new WebSocket.Server({ noServer: true })

wss.on('connection', (conn, req) => {
  const url = req.url || '/'
  console.log(`[yjs] 연결: ${url} from ${req.socket.remoteAddress}`)

  // y-websocket 기본 설정 사용 (docName은 URL 경로에서 추출)
  setupWSConnection(conn, req, {
    gc: true  // garbage collection 활성화
  })
})

server.on('upgrade', (request, socket, head) => {
  const handleAuth = ws => {
    wss.emit('connection', ws, request)
  }
  wss.handleUpgrade(request, socket, head, handleAuth)
})

server.listen(port, host, () => {
  console.log(`[yjs] 서버 시작: ${host}:${port}`)
  console.log('[yjs] WebSocket: ws://0.0.0.0:' + port + '/{docName}')
  console.log('[yjs] Health:    http://0.0.0.0:' + port + '/health')
})
