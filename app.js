const scenes = {
  morning: {
    time: '早上好', title: '先看清今天，再开始。',
    summary: '昨天的进度已整理，今天从这里接着做。',
    items: [['09:00', '推进正在做的项目', '先完成昨天留下的下一步'], ['18:30', '留一点时间给运动', '按你的作息，提出今天的训练建议'], ['22:00', '回看这一天', '记录完成了什么，明天从哪里继续']],
    bottom: '建议留给你确认，进度留给下一次接手的 AI。'
  },
  day: {
    time: '随手记下来', title: '说一句，进度就有了着落。',
    summary: '示例：今天深蹲 3 × 12，60 kg。',
    items: [['输入', '用你习惯的方式说', '在 Agent 对话或已连接的消息通道里记录'], ['整理', '写入训练记录', '动作、组数、次数与重量归入健康模块'], ['回看', '下一次还能接着练', '保留记录与版本，给后续安排提供参考']],
    bottom: '这是使用流程示意，没有读取或写入任何个人资料。'
  },
  evening: {
    time: '晚上好', title: '今天走过的，明天接得上。',
    summary: '对照今天的计划，整理完成情况与未决事项。',
    items: [['完成', '记录实际发生的事', '区分已完成、未完成与尚待确认'], ['复盘', '留下值得记住的变化', '整理记录，更新项目与模块的下一步'], ['继续', '把进度交给下一次对话', '同一个助手或另一个 Agent 都能从现状接手']],
    bottom: '云端接力采用追加记录与定期整理，具体能力见项目文档。'
  }
};
for (const button of document.querySelectorAll('[data-scene]')) {
  button.addEventListener('click', () => {
    const scene = scenes[button.dataset.scene];
    for (const other of document.querySelectorAll('[data-scene]')) other.setAttribute('aria-pressed', String(other === button));
    for (const key of ['time', 'title', 'summary', 'bottom']) document.getElementById(`demo-${key}`).textContent = scene[key];
    const rows = scene.items.map(([time, title, description]) => {
      const row = document.createElement('div');
      const label = document.createElement('time');
      label.textContent = time;
      const text = document.createElement('span');
      const strong = document.createElement('strong');
      strong.textContent = title;
      const small = document.createElement('small');
      small.textContent = description;
      text.append(strong, small);
      row.append(label, text);
      return row;
    });
    document.getElementById('demo-timeline').replaceChildren(...rows);
    document.getElementById('scene-announcement').textContent = scene.title;
  });
}
