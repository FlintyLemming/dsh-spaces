// 冷启动/重建期间返回的静态页。没有构建管线，所以样式内联，
// 但配色与圆角刻意与前端 styles.css 的 token 保持一致。
function page(title, message, detail, tone) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta http-equiv="refresh" content="3">
<title>${title}</title>
<style>
  :root {
    --bg: #ffffff; --surface: #ffffff; --border: #e5e5e5;
    --fg: #171717; --muted: #666666; --subtle: #8f8f8f;
    --accent: #a35200; --accent-bg: #fff3e0;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0a0a0a; --surface: #121212; --border: #262626;
      --fg: #ededed; --muted: #a1a1a1; --subtle: #7a7a7a;
      --accent: #f0a02a; --accent-bg: #2a1c05;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    background: var(--bg); color: var(--fg);
    font-family: 'Geist Sans', -apple-system, 'Segoe UI', 'PingFang SC', system-ui, sans-serif;
    font-size: 14px; line-height: 1.55; -webkit-font-smoothing: antialiased;
  }
  main {
    width: 100%; max-width: 420px; padding: 28px;
    border: 1px solid var(--border); border-radius: 12px; background: var(--surface);
    text-align: center;
  }
  .dot {
    display: inline-block; width: 8px; height: 8px; border-radius: 999px;
    background: var(--accent); margin-right: 8px; vertical-align: middle;
    animation: pulse 1.4s ease-in-out infinite;
  }
  .tag {
    display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 999px;
    background: var(--accent-bg); color: var(--accent); font-size: 12px; font-weight: 500;
  }
  h1 { margin: 16px 0 0; font-size: 18px; font-weight: 600; letter-spacing: -0.02em; }
  p { margin: 8px 0 0; color: var(--muted); }
  .mono {
    margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border);
    font-family: 'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 12px; color: var(--subtle); word-break: break-all;
  }
  @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: .25 } }
  @media (prefers-reduced-motion: reduce) { .dot { animation: none } }
</style>
</head>
<body>
  <main>
    <span class="tag"><span class="dot"></span>${tone}</span>
    <h1>${title}</h1>
    <p>${message}</p>
    <p class="mono">${detail}</p>
  </main>
</body>
</html>`
}

export function waitingPage({ containerName, timedOut = false }) {
  return page(
    '实例启动中',
    timedOut
      ? '实例启动超时。页面将继续自动重试；如长时间无法启动，请联系管理员。'
      : '实例正在冷启动，页面将在就绪后自动加载。',
    containerName,
    timedOut ? '启动超时' : '启动中',
  )
}

export function rebuildingPage({ containerName }) {
  return page(
    '实例异常，正在重建',
    '检测到实例崩溃或编排失败，正在保留数据卷重建。页面将自动重试。',
    containerName,
    '重建中',
  )
}
