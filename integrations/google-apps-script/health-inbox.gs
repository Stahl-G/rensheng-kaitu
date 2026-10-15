// 开图健康收件箱：接收快捷指令数据，写入 Google Drive 的 kaitu/inbox/health/。
// 1. 打开 script.new，新建项目并粘贴本文件。
// 2. 部署 → 新建部署 → 网页应用，执行身份「我」、访问权限「任何人」，完成授权。
// 3. 用部署账号打开部署网址，复制「你的同步地址」，在手机安装快捷指令时粘贴。

var FOLDER_PATH = ['kaitu', 'inbox', 'health'];
var MAX_BYTES = 5 * 1024 * 1024;

function getKey() {
  var properties = PropertiesService.getScriptProperties();
  var key = properties.getProperty('KAITU_KEY');
  if (key) return key;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    key = properties.getProperty('KAITU_KEY');
    if (!key) {
      key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
      properties.setProperty('KAITU_KEY', key);
    }
    return key;
  } finally {
    lock.releaseLock();
  }
}

function syncUrl() {
  var url = ScriptApp.getService().getUrl();
  if (!url) throw new Error('请先部署为网页应用，再运行 showSyncUrl。');
  return url + '?key=' + encodeURIComponent(getKey());
}

function showSyncUrl() {
  Logger.log(syncUrl());
}

function doGet() {
  var activeEmail = Session.getActiveUser().getEmail();
  if (!activeEmail || activeEmail !== Session.getEffectiveUser().getEmail()) {
    return ContentService.createTextOutput('开图健康收件箱');
  }
  var url = syncUrl();
  var status;
  try {
    var inbox = folder(false);
    status = inbox ? '收件夹 kaitu/inbox/health 已存在。' : '收件夹 kaitu/inbox/health 尚不存在，首次同步会自动创建。';
    if (inbox) {
      var files = inbox.getFiles();
      var latest = null;
      while (files.hasNext()) {
        var file = files.next();
        if (!latest || file.getLastUpdated() > latest.getLastUpdated()) latest = file;
      }
      status += latest
        ? '\n最近文件：' + latest.getName() + '\n时间：' + latest.getLastUpdated().toISOString()
        : '\n还没有收到文件（已导入的文件可能已归档）。';
    }
  } catch (err) {
    status = '暂时无法检查收件夹：' + err.message;
  }
  var html = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>开图健康同步设置</title>
<style>
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 640px; padding: 32px 20px; font: 16px/1.7 system-ui, sans-serif; }
h1 { font-size: 30px; line-height: 1.3; }
h2 { font-size: 20px; margin-top: 32px; }
textarea { width: 100%; padding: 12px; font: 16px/1.5 ui-monospace, monospace; resize: vertical; }
button { padding: 12px 20px; min-height: 44px; font: inherit; cursor: pointer; margin-top: 12px; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
</style></head>
<body>
<p>开图 · 健康同步</p>
<h1>你的同步地址</h1>
<textarea id="sync-url" aria-label="你的同步地址" rows="5" readonly>${escapeHtml(url)}</textarea>
<button id="copy" type="button">复制</button><p id="copy-status" role="status"></p>
<h2>下一步：在手机安装快捷指令</h2>
<p>回到安装页，在 iPhone 上点「添加快捷指令」。安装时问「粘贴你的同步地址」，粘贴上方完整地址即可。</p>
<p>安装后手动运行一次，允许读取健康数据，再按安装页说明设为每晚 22:00 自动运行。</p>
<h2>自检状态</h2><pre>${escapeHtml(status)}</pre>
<p>首次运行后刷新本页，可以查看收件状态。时间以 UTC 显示。</p>
<script>
document.getElementById('copy').addEventListener('click', async function () {
  var field = document.getElementById('sync-url');
  var status = document.getElementById('copy-status');
  try {
    await navigator.clipboard.writeText(field.value);
    status.textContent = '已复制';
  } catch (err) {
    field.focus();
    field.select();
    field.setSelectionRange(0, field.value.length);
    status.textContent = document.execCommand('copy') ? '已复制' : '已选中地址，请长按或按复制键复制。';
  }
});
</script></body></html>`;
  return HtmlService.createHtmlOutput(html)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, function (character) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
  });
}

function doPost(e) {
  var expected = getKey();
  if (!expected || !e || !e.parameter || e.parameter.key !== expected) {
    return reply({ ok: false, error: '密钥不对' });
  }
  var body = e.postData && e.postData.contents;
  if (!body) return reply({ ok: false, error: '没有收到数据' });
  if (body.length > MAX_BYTES) return reply({ ok: false, error: '数据太大' });
  var isJson = true;
  try {
    JSON.parse(body);
  } catch (err) {
    isJson = false;
  }
  // 不是 JSON 也不丢：存成 .txt，开图会把它当待整理笔记
  var stamp = Utilities.formatDate(new Date(), 'UTC', "yyyyMMdd'T'HHmmss'Z'");
  var name = stamp + '-' + Utilities.getUuid().slice(0, 8) + (isJson ? '.health.json' : '.health.txt');
  folder().createFile(name, body, isJson ? 'application/json' : 'text/plain');
  return reply({ ok: true, file: name });
}

function folder(create) {
  var current = DriveApp.getRootFolder();
  for (var i = 0; i < FOLDER_PATH.length; i++) {
    var part = FOLDER_PATH[i];
    var found = current.getFoldersByName(part);
    if (!found.hasNext() && create === false) return null;
    current = found.hasNext() ? found.next() : current.createFolder(part);
  }
  return current;
}

function reply(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
