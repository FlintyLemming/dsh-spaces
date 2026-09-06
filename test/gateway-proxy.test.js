import { test } from 'vitest'
import assert from 'node:assert/strict'
import http from 'node:http'
import { waitingPage, rebuildingPage } from '../src/gateway/pages.js'
import { createGatewayProxy, STRIPPED_REQUEST_HEADERS } from '../src/gateway/proxy.js'

function upstream(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler)
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }))
  })
}

test('waitingPage is self-refreshing and names the container', () => {
  const html = waitingPage({ containerName: 'dsh-team-a-alice', timedOut: false })
  assert.match(html, /refresh/)
  assert.match(html, /dsh-team-a-alice/)
  assert.match(html, /实例启动中/)
  const timedOut = waitingPage({ containerName: 'c', timedOut: true })
  assert.match(timedOut, /超时|重试/)
})

test('rebuildingPage explains the rebuild', () => {
  assert.match(rebuildingPage({ containerName: 'c' }), /重建/)
})

test('proxy strips credential headers and upstream set-cookie', async () => {
  assert.ok(STRIPPED_REQUEST_HEADERS.includes('cookie'))
  assert.ok(STRIPPED_REQUEST_HEADERS.includes('authorization'))
  assert.ok(STRIPPED_REQUEST_HEADERS.includes('x-csrf-token'))

  const { srv, port } = await upstream((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'evil=1' })
    res.end(JSON.stringify({
      cookie: req.headers.cookie ?? null,
      authorization: req.headers.authorization ?? null,
      'x-csrf-token': req.headers['x-csrf-token'] ?? null,
      host: req.headers.host,
    }))
  })
  const proxy = createGatewayProxy()
  const front = http.createServer((req, res) => {
    proxy.web(req, res, { target: `http://127.0.0.1:${port}` })
  })
  await new Promise((r) => front.listen(0, '127.0.0.1', r))
  const frontPort = front.address().port

  const body = await new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: frontPort, path: '/x', headers: {
        cookie: 'dsh_session=abc', authorization: 'Bearer t', 'x-csrf-token': 'z',
      },
    }, (res) => {
      assert.equal(res.headers['set-cookie'], undefined)
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => resolve(JSON.parse(data)))
    })
    req.on('error', reject)
    req.end()
  })
  assert.equal(body.cookie, null)
  assert.equal(body.authorization, null)
  assert.equal(body['x-csrf-token'], null)
  assert.equal(body.host, `127.0.0.1:${port}`) // changeOrigin
  front.close(); srv.close()
})

test('proxy error yields 502 upstream unavailable', async () => {
  const proxy = createGatewayProxy()
  const front = http.createServer((req, res) => {
    proxy.web(req, res, { target: 'http://127.0.0.1:1' }) // 必然拒绝
  })
  await new Promise((r) => front.listen(0, '127.0.0.1', r))
  const { statusCode } = await fetch(`http://127.0.0.1:${front.address().port}/`)
    .then((r) => ({ statusCode: r.status }))
  assert.equal(statusCode, 502)
  front.close()
})
