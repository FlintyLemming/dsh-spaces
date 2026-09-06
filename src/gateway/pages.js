function page(title, message, detail) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="3">
<title>${title}</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         font-family: -apple-system, 'Segoe UI', system-ui, sans-serif;
         background: #fff; color: #171717; }
  main { max-width: 64ch; padding: 24px; }
  h1 { font-size: 20px; font-weight: 600; letter-spacing: -0.02em; }
  p { color: #737373; font-size: 14px; line-height: 1.6; }
  .mono { font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 12px; }
  @media (prefers-color-scheme: dark) {
    body { background: #0a0a0a; color: #ededed; }
    p { color: #a3a3a3; }
  }
</style>
</head>
<body><main><h1>${title}</h1><p>${message}</p><p class="mono">${detail}</p></main></body>
</html>`
}

export function waitingPage({ containerName, timedOut = false }) {
  return page(
    '实例启动中',
    timedOut
      ? '实例启动超时。页面将继续自动重试；如长时间无法启动，请联系管理员。'
      : '实例正在冷启动，页面将在就绪后自动加载。',
    containerName,
  )
}

export function rebuildingPage({ containerName }) {
  return page(
    '实例异常，正在重建',
    '检测到实例崩溃或编排失败，正在保留数据卷重建。页面将自动重试。',
    containerName,
  )
}
