/**
 * 开图健康收件箱：接收 iPhone 快捷指令 POST 的健康数据，写进 Google Drive 的 kaitu/inbox/health/。
 *
 * 部署：script.google.com 新建项目，粘贴本文件 → 「项目设置」里添加脚本属性 KAITU_KEY（任意长随机字符串）
 * → 「部署 → 新建部署 → 网页应用」，执行身份选「我」，访问权限选「任何人」→ 复制网页应用地址。
 * 快捷指令向 <地址>?key=<KAITU_KEY> 发送 POST，请求体是 JSON。
 */

var FOLDER_PATH = ['kaitu', 'inbox', 'health'];
var MAX_BYTES = 5 * 1024 * 1024;

function doPost(e) {
  var expected = PropertiesService.getScriptProperties().getProperty('KAITU_KEY');
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

function folder() {
  var current = DriveApp.getRootFolder();
  FOLDER_PATH.forEach(function (part) {
    var found = current.getFoldersByName(part);
    current = found.hasNext() ? found.next() : current.createFolder(part);
  });
  return current;
}

function reply(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
