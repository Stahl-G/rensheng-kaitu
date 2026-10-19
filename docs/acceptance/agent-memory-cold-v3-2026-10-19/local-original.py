from pathlib import Path
import subprocess, shutil, json
root=Path('/tmp/kaitu-cold-v3'); repo=root/'repo'; out=root/'evidence'
def run(*args,cwd=None):
 p=subprocess.run(args,cwd=cwd,text=True,capture_output=True)
 with (out/'local-original.log').open('a') as f: f.write('$ '+' '.join(args)+'\n'+p.stdout+p.stderr+f'\nexit={p.returncode}\n')
 if p.returncode: raise RuntimeError(p.stderr)
 return p.stdout
# All Git identities are command-local synthetic values; no global configuration.
def git(*args,cwd): return run('git','-c','user.name=Cold Read Synthetic','-c','user.email=cold-read@example.invalid',*args,cwd=cwd)
project=root/'synthetic-project'; project.mkdir(); git('init','-b','main',cwd=project)
(project/'README.md').write_text('# 合成项目：纸舟\n完成数据导入，下一步补导出。\n')
(project/'HANDOFF.md').write_text('2026-10-19：CSV 导入完成。失败：旧导出丢列；阻塞：字段顺序未定。下一步确认顺序再导出。\n')
git('add','README.md','HANDOFF.md',cwd=project);git('commit','-m','Complete synthetic CSV import',cwd=project)
git('init','--bare','--initial-branch=main',str(root/'project.git'),cwd=root)
git('remote','add','origin',str(root/'project.git'),cwd=project);git('push','-u','origin','main',cwd=project)
git('fetch','origin',cwd=project); head=git('rev-parse','origin/main',cwd=project).strip()
run('git','show','origin/main:HANDOFF.md',cwd=project);run('git','log','-1','origin/main',cwd=project)
mem=root/'original-memory';shutil.copytree(repo/'docs/guides/agent-memory/template',mem)
(mem/'me/profile.md').write_text('# 合成个人资料\n姓名：测试员纸舟（虚构）；推进合成 CSV 项目；偏好简体中文、简洁回答。\n')
(mem/'me/rules.md').write_text('---\ntimezone: Etc/UTC\n---\n# 约束\n全部合成数据，不使用真实账号。\n')
(mem/'me/goals.json').write_text(json.dumps([{'id':'synthetic-csv','title':'完成合成 CSV 导出','status':'active'}],ensure_ascii=False)+'\n')
p=mem/'projects/paperboat';p.mkdir(parents=True)
(p/'STATUS.md').write_text(f'---\ntitle: 合成纸舟\nkind: work\nstage: active\nupdated: "2026-10-19"\nlinks: []\nnext:\n  - 确认 CSV 字段顺序后实现导出\n---\n# 合成纸舟\n已完成导入。失败：旧导出丢列。阻塞：字段顺序未定。\n来源：本地普通 bare project.git，main {head}，读取日期 2026-10-19。GitHub PR/issue 未验，不等于没有。\n')
(p/'log.md').write_text('# 项目进展\n\n## 2026-10-19\n\n完成导入；旧导出丢列；字段顺序待定；下一步确认后导出。来源：本地 main '+head+'；本次交接 handoffs/20261019T2030-cold-agent.md。\n')
(out/'synthetic-preview.md').write_text('本地实验预览：仓库 /tmp/kaitu-cold-v3/memory.git；无 GitHub 上传。资料全为虚构。\n\n'+(mem/'me/profile.md').read_text()+'\n'+(p/'STATUS.md').read_text())
git('init','--bare','--initial-branch=main',str(root/'memory.git'),cwd=root)
git('init','-b','main',cwd=mem);git('add','.',cwd=mem);git('commit','-m','Initialize synthetic memory (INSTALL step 7)',cwd=mem)
git('remote','add','origin',str(root/'memory.git'),cwd=mem);git('push','-u','origin','main',cwd=mem)
# Step 8 explicitly skips phone for no-kaitu; step 9 then writes handoff.
(mem/'handoffs/20261019T2030-cold-agent.md').write_text('---\nagent: cold-agent\nat: 2026-10-19T20:30:00+00:00\n---\n## 做了什么\n整理合成档案和纸舟进度。\n## 当前下一步\n确认字段顺序，补导出。\n## 未决 / 需要用户\nGitHub 私库、PR/issue、手机生成均未验。\n')
run('git','status','--short',cwd=mem)
second=root/'original-second';run('git','clone',str(root/'memory.git'),str(second),cwd=root)
for path in ['me/profile.md','projects/paperboat/STATUS.md','kaitu-backup.json']:
 text=(second/path).read_text();(out/('original-remote-'+Path(path).name)).write_text(text)
assert not (second/'handoffs/20261019T2030-cold-agent.md').exists()
(out/'original-outcome.md').write_text('原文逐序执行后：第7步已推送，第8步无 kaitu 跳过，第9步新建交接，第10步只回读与确认提交，未要求再次提交推送。git status 有 ?? handoffs/20261019T2030-cold-agent.md；第二克隆无该交接。合成档案、项目 STATUS、manifest 均已在 bare 远端回读。手机内容未生成（遵循原说明跳过）。第二 Agent 提示词可填本地地址，但必须明确无法验证 GitHub 可见性与 App 同步。\n')
(out/'second-agent-local-prompt.txt').write_text('请按 ADD_DEVICE.md 接上我的合成开图记忆 /tmp/kaitu-cold-v3/memory.git，读完告诉我你记住了什么。本地址是普通本地 bare Git，仅验证文件和 Git，不能验证 GitHub 私有性或开图 iPhone 接入。\n')
