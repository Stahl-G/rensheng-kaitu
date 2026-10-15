const captions = {
  overview: '今天的安排、下一步和要你确认的事。',
  health: '训练、饮食、睡眠和身体数据。',
  doing: '你的项目和长期计划，以及进度。',
  news: '你关注的领域每天的新消息。',
  me: '目标、作息规则和 AI 记住的你。'
};
for (const button of document.querySelectorAll('[data-preview]')) {
  button.addEventListener('click', () => {
    const key = button.dataset.preview;
    for (const other of document.querySelectorAll('[data-preview]')) other.setAttribute('aria-pressed', String(other === button));
    document.getElementById('preview-caption').textContent = captions[key];
    document.getElementById('product-preview').src = `previews/${key}.html`;
    document.getElementById('product-preview').title = `${button.textContent}：原有设计稿示意，非个人工作区`;
    document.getElementById('preview-full').href = `previews/${key}.html`;
  });
}
