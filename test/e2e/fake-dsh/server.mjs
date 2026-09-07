// test/e2e/fake-dsh/server.mjs
// 不需要实现 BASE_PATH：网关在反代前剥离 /s/<slug>/<handle> 前缀（计划 04），
// 实例永远看到根相对路径——本服务对任何路径返回 200 即验证了这一点。
import { createServer } from 'node:http'
createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end(`<h1>fake dsh</h1><p class="mono">${req.url}</p>`)
}).listen(3000, '0.0.0.0', () => console.log('fake dsh on 3000'))
