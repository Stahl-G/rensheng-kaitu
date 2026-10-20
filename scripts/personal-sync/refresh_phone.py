#!/usr/bin/env python3
"""Generate phone snapshots from an isolated approved content copy, then upload one way."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile
from sync import read, check_path, inside, atomic


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['right', 'state', 'files']:
        p.add_argument('--' + name, required=True)
    args = p.parse_args()
    right, state = Path(args.right).resolve(), Path(args.state).resolve()
    if not right.is_dir() or inside(state, right):
        p.error('Use an available cloud folder and external local state')
    names = [check_path(n) for n in json.loads(Path(args.files).read_text())]
    # No process ever opens the live source workspace. Only approved content is projected.
    content = {n: read(right, n) for n in names}
    if any(raw is None for raw in content.values()):
        p.error('Approved content is missing; snapshots were not replaced')
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.TemporaryDirectory(dir=state) as temp:
        stage = Path(temp)
        for name, raw in content.items():
            atomic(stage / name, raw)
        atomic(stage / '.kaitu/config.json', json.dumps({'version': 1, 'modules': sorted({Path(n).parts[0] for n in names})}).encode())
        import os
        env = {**os.environ, 'KAITU_LOCAL_STATE_DIR': str(state / 'generator')}
        subprocess.run(['node', str(Path(__file__).with_name('generate-phone.mjs')), str(stage)], check=True, env=env)
        if not right.is_dir():
            p.error('Cloud folder disconnected; snapshots were not replaced')
        for name in ['today', 'week', 'map', 'library', 'receipts']:
            if (right / 'phone').is_symlink() or (right / 'phone' / (name + '.json')).is_symlink():
                p.error('Phone destination contains a symlink; no writes allowed')
        for name in ['today', 'week', 'map', 'library', 'receipts']:
            atomic(right / 'phone' / (name + '.json'), (stage / 'phone' / (name + '.json')).read_bytes())
    print('Five snapshots refreshed locally; cloud delivery has not been verified.')


if __name__ == '__main__':
    main()
