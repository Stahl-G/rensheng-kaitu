from pathlib import Path
import subprocess, shutil
root=Path('/tmp/kaitu-cold-v3');out=root/'evidence';mem=root/'original-memory'
def run(*args,cwd=None):
 p=subprocess.run(args,cwd=cwd,text=True,capture_output=True)
 with (out/'retest.log').open('a') as f:f.write('$ '+' '.join(args)+'\n'+p.stdout+p.stderr+f'\nexit={p.returncode}\n')
 if p.returncode:raise RuntimeError(p.stderr)
 return p.stdout
def git(*args,cwd):return run('git','-c','user.name=Cold Read Synthetic','-c','user.email=cold-read@example.invalid',*args,cwd=cwd)
# Now follow corrected INSTALL step 9; no source code modification.
git('add','handoffs/20261019T2030-cold-agent.md',cwd=mem);git('commit','-m','Include first synthetic handoff',cwd=mem);git('push',cwd=mem)
second=root/'fixed-second';run('git','clone',str(root/'memory.git'),str(second),cwd=root)
files=['me/profile.md','projects/paperboat/STATUS.md','projects/paperboat/log.md','handoffs/20261019T2030-cold-agent.md']
for path in files:
 assert (second/path).read_bytes()==(mem/path).read_bytes()
(out/'retest-files.txt').write_text('远端独立克隆逐字节核对通过：\n'+'\n'.join(files)+'\nHEAD='+run('git','rev-parse','HEAD',cwd=second))
# Separate supplementary phone exercise; original no-kaitu route remains skipped.
phone=root/'phone-memory';shutil.copytree(second,phone,ignore=shutil.ignore_patterns('.git'))
# Correct our synthetic fixture's next shape using the actual schema; not a product fix.
p=phone/'projects/paperboat/STATUS.md'
p.write_text(p.read_text().replace('  - 确认 CSV 字段顺序后实现导出','  - id: synthetic-export\n    title: 确认 CSV 字段顺序后实现导出\n    status: todo'))
(out/'phone-fixture-note.md').write_text('补充诊断：直接在未初始化模板调用 runPhone 报缺 .kaitu/config.json，属跳过 ADD_DEVICE 的 init 前置条件，不是产品缺陷。按 ADD_DEVICE 先 init；另将测试脚本自填的 next 字符串改为 schema 规定对象，此项是测试数据修正，未据此改产品文档。\n')
