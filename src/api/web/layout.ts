/**
 * M9.1 — The command-center shell (pure HTML). One dark, responsive layout
 * that every owner page renders inside: sidebar nav + header with the
 * employee's name. Owner language only — no AI/technical vocabulary anywhere.
 * Design language matches the operator status page.
 */

export const NAV: readonly { readonly href: string; readonly id: string; readonly label: string; readonly icon: string }[] = [
  { href: '/app',               id: 'home',          label: '主页',     icon: '🏠' },
  { href: '/app/inbox',         id: 'inbox',         label: '收件箱',   icon: '📥' },
  { href: '/app/conversations', id: 'conversations', label: '对话记录', icon: '💬' },
  { href: '/app/channels',      id: 'channels',      label: '销售渠道', icon: '🔗' },
  { href: '/app/products',      id: 'products',      label: '产品目录', icon: '📦' },
  { href: '/app/employee',      id: 'employee',      label: '员工档案', icon: '🧑‍💼' },
  { href: '/app/analytics',     id: 'analytics',     label: '经营数据', icon: '📊' },
];

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0b0d10; color: #e6e8eb;
    font: 15px/1.5 -apple-system, "Segoe UI", "Noto Sans SC", system-ui, sans-serif; }
  a { color: inherit; text-decoration: none; }
  .layout { display: grid; grid-template-columns: 232px 1fr; min-height: 100vh; }
  nav.side { background: #101317; border-right: 1px solid #23272e; padding: 20px 12px; }
  .brand { font-weight: 700; font-size: 17px; padding: 6px 12px 18px; letter-spacing: .3px; }
  .brand small { display:block; color:#6b7280; font-weight:500; font-size:12px; letter-spacing:0; margin-top:2px; }
  nav.side a { display: flex; align-items: center; gap: 10px; padding: 10px 12px;
    border-radius: 10px; color: #b9c0c9; font-size: 14px; margin-bottom: 2px; }
  nav.side a:hover { background: #171b21; color: #fff; }
  nav.side a.active { background: #1b2430; color: #fff; }
  nav.side a .ic { width: 20px; text-align: center; }
  header.top { display: flex; align-items: center; justify-content: space-between;
    padding: 16px 28px; border-bottom: 1px solid #23272e; }
  header.top .who { display:flex; align-items:center; gap:10px; }
  header.top .avatar { width: 30px; height: 30px; border-radius: 999px; background:#1b2430;
    display:flex; align-items:center; justify-content:center; font-size:16px; }
  header.top .logout { color:#6b7280; font-size:13px; }
  header.top .logout:hover { color:#f87171; }
  main { padding: 28px; max-width: 1040px; }
  h1.page { font-size: 20px; margin: 0 0 18px; }
  .card { background:#14171c; border:1px solid #23272e; border-radius:14px; padding:20px; margin:16px 0; }
  .card h2 { font-size:13px; text-transform:uppercase; letter-spacing:.8px; color:#8b929c; margin:0 0 14px; font-weight:600; }
  .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
  .stat { background:#0f1216; border:1px solid #23272e; border-radius:10px; padding:16px; text-align:center; }
  .stat .v { font-size:28px; font-weight:700; color:#fff; }
  .stat .l { font-size:12px; color:#8b929c; margin-top:4px; }
  .pill { display:inline-block; padding:5px 12px; border-radius:999px; font-size:13px; font-weight:600; margin:0 8px 8px 0; }
  .pill.ok { background:#0f2e1c; color:#4ade80; } .pill.bad { background:#2e1414; color:#f87171; }
  .pill.warn { background:#2e2413; color:#fbbf24; }
  pre { background:#0f1216; border:1px solid #23272e; border-radius:10px; padding:18px; overflow-x:auto;
    font:14px/1.55 "SF Mono", ui-monospace, Menlo, monospace; color:#d6dae0; white-space:pre; margin:0; }
  .muted { color:#6b7280; font-size:13px; }
  .empty { text-align:center; color:#8b929c; padding:40px 20px; }
  @media (max-width: 720px) {
    .layout { grid-template-columns: 1fr; }
    nav.side { display:flex; flex-wrap:wrap; gap:4px; border-right:none; border-bottom:1px solid #23272e; }
    nav.side .brand { width:100%; padding-bottom:10px; }
    nav.side a { margin:0; padding:8px 10px; }
    .stats { grid-template-columns: repeat(2,1fr); }
  }
`;

export function shell(input: {
  readonly title: string;
  readonly active: string;
  readonly employeeName: string;
  readonly avatar: string;
  readonly bodyHtml: string;
}): string {
  const nav = NAV.map((n) =>
    `<a href="${n.href}" class="${n.id === input.active ? 'active' : ''}">
       <span class="ic">${n.icon}</span>${esc(n.label)}</a>`).join('');
  return `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(input.title)} · ${esc(input.employeeName)}</title>
<style>${STYLE}</style></head>
<body><div class="layout">
  <nav class="side">
    <div class="brand">YiwuFlow<small>${esc(input.employeeName)} 的工作台</small></div>
    ${nav}
  </nav>
  <div>
    <header class="top">
      <div class="who"><span class="avatar">${input.avatar}</span>
        <div><div style="font-weight:600">${esc(input.employeeName)}</div>
        <div class="muted" style="font-size:12px">试用期 · 你在带她</div></div></div>
      <a class="logout" href="/logout">退出</a>
    </header>
    <main>${input.bodyHtml}</main>
  </div>
</div></body></html>`;
}

export function loginPage(input: { readonly error?: string }): string {
  return `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>YiwuFlow · 登录</title>
<style>${STYLE}
  .login { max-width: 360px; margin: 12vh auto; padding: 0 20px; }
  .login .card { padding: 28px; }
  input { width:100%; padding:12px 14px; border-radius:10px; border:1px solid #2b313a;
    background:#0f1216; color:#fff; font-size:15px; margin:8px 0 14px; }
  button { width:100%; padding:12px; border:0; border-radius:10px; background:#2563eb;
    color:#fff; font-weight:600; font-size:15px; cursor:pointer; }
  button:hover { background:#1d4ed8; }
  .err { color:#f87171; font-size:13px; margin-bottom:8px; }
</style></head>
<body><div class="login">
  <div class="brand" style="font-weight:700;font-size:19px;margin-bottom:8px">YiwuFlow<small class="muted" style="display:block;font-size:12px">你的数字员工工作台</small></div>
  <div class="card">
    ${input.error ? `<div class="err">${esc(input.error)}</div>` : ''}
    <form method="post" action="/login">
      <label class="muted">进入密码</label>
      <input type="password" name="code" autofocus autocomplete="current-password" />
      <button type="submit">进入工作台</button>
    </form>
  </div>
  <p class="muted" style="text-align:center;font-size:12px">仅限老板本人 · 员工的接待仍在 WhatsApp</p>
</div></body></html>`;
}

/** A simple in-shell placeholder for sections not yet built (M9.2+). */
export function underConstruction(sectionZh: string): string {
  return `<h1 class="page">${esc(sectionZh)}</h1>
    <div class="card"><div class="empty">这个部分马上就好。<br><span class="muted">正在按顺序搭建工作台。</span></div></div>`;
}
