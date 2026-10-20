#!/usr/bin/env python3
"""Manual content-only sync between two already populated personal cloud folders."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile

CREDENTIAL = re.compile(rb'-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[A-Za-z0-9_-]{25,}|AKIA[A-Z0-9]{16})|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)\s*["\x27]?\s*[:=]\s*["\x27]?[A-Za-z0-9_+/=-]{10,}', re.I)
HEALTH = re.compile(r'healthkit|apple[- ]health|health[/\\]|健康|饮食|睡眠|体重|训练|血压|心率|蛋白|健身|卡路里|workout|body_fat', re.I)
ROOTS = {'projects', 'memory', 'me', 'learning', 'decisions', 'explore', 'inbox', 'calendar', 'finance'}


def inside(path, root):
    return path == root or root in path.parents


def check_path(name):
    p = Path(name)
    if p.is_absolute() or not p.parts or any(x in {'.', '..'} or x.startswith('.') for x in p.parts):
        raise ValueError('Invalid content path')
    if p.parts[0] not in ROOTS or p.suffix not in {'.md', '.json', '.jsonl'}:
        raise ValueError('Path outside explicit content scope')
    if any(re.search(r'cache|backup|logs?|secret|token|credential|auth|private.?key|备份', x, re.I) for x in p.parts):
        raise ValueError('Excluded content path')
    if HEALTH.search(name):
        raise ValueError('Health content excluded')
    return name


def read(root, name):
    path = root / name
    for parent in [path, *path.parents]:
        if parent == root:
            break
        if parent.is_symlink():
            raise ValueError('Symlinks are not supported')
    try:
        st = path.stat()
    except FileNotFoundError:
        return None
    if not path.is_file() or getattr(st, 'st_flags', 0) & 0x40000000:
        raise ValueError('Content unavailable or not downloaded')
    raw = path.read_bytes()
    if CREDENTIAL.search(raw) or HEALTH.search(raw.decode('utf-8')):
        raise ValueError('Mixed credential or health content; review locally')
    return raw


def digest(raw):
    return None if raw is None else hashlib.sha256(raw).hexdigest()


def atomic(path, raw):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(raw)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def sync(left, right, state, names, apply=False, initialize=False):
    left, right, state = map(lambda p: Path(p).resolve(), (left, right, state))
    if not left.is_dir() or not right.is_dir():
        raise ValueError('Cloud folder unavailable; no writes attempted')
    if inside(left, right) or inside(right, left) or inside(state, left) or inside(state, right):
        raise ValueError('Use separate cloud roots and a state directory outside both')
    names = sorted(set(check_path(n) for n in names))
    baseline_file = state / 'baseline.json'
    old = json.loads(baseline_file.read_text()) if baseline_file.exists() else None
    identity = {'left': str(left), 'right': str(right), 'files': names}
    if old and any(old[k] != v for k, v in identity.items()):
        raise ValueError('Baseline belongs to different roots or file list')
    if not old and not initialize:
        raise ValueError('Initialize an equal common baseline first')
    # Preflight every listed file before any mutation. Offline/evicted files fail here.
    contents = {n: (read(left, n), read(right, n)) for n in names}
    if initialize:
        if old:
            raise ValueError('Baseline already exists')
        if any(a is None or a != b for a, b in contents.values()):
            raise ValueError('Initialization requires identical downloaded content on both sides')
    baseline = dict(old['baseline']) if old else {}
    plan = []
    for name, (a, b) in contents.items():
        ah, bh = digest(a), digest(b)
        base = baseline.get(name)
        if ah == bh:
            baseline[name] = ah
            continue
        if a is None or b is None:
            # Never propagate deletion. New one-sided content is copied only after
            # an initialized baseline explicitly records this path as absent.
            if base is not None:
                plan.append({'path': name, 'action': 'missing-retained'})
                continue
        if ah == base:
            action = 'right-to-left'
        elif bh == base:
            action = 'left-to-right'
        else:
            action = 'conflict'
        plan.append({'path': name, 'action': action})
    if apply:
        state.mkdir(parents=True, exist_ok=True, mode=0o700)
        lock = state / 'running.lock'
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            raise ValueError('Another run or interrupted lock exists; inspect before retrying')
        os.close(fd)
        try:
            # Root disappearance must not turn a disconnected mount into a new directory.
            for item in plan:
                name, action = item['path'], item['action']
                a, b = contents[name]
                if not left.is_dir() or not right.is_dir() or read(left, name) != a or read(right, name) != b:
                    raise ValueError('Folder changed during preview; retry without overwriting')
                if action == 'missing-retained':
                    continue
                # Content-addressed recovery copies also make repeated conflicts idempotent.
                for side, raw in [('left', a), ('right', b)]:
                    if raw is not None:
                        recovery = state / 'recovery' / name / (side + '-' + digest(raw))
                        if not recovery.exists():
                            atomic(recovery, raw)
                if action == 'conflict':
                    continue
                raw = a if action == 'left-to-right' else b
                atomic((right if action == 'left-to-right' else left) / name, raw)
                baseline[name] = digest(raw)
                atomic(baseline_file, json.dumps({**identity, 'baseline': baseline}).encode())
            atomic(baseline_file, json.dumps({**identity, 'baseline': baseline}).encode())
        finally:
            lock.unlink()
    return {'applied': apply, 'initialized': initialize, 'changes': plan, 'cloud_delivery': 'not verified; local filesystem only'}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['left', 'right', 'state', 'files']:
        p.add_argument('--' + name, required=True)
    p.add_argument('--apply', action='store_true')
    p.add_argument('--initialize', action='store_true')
    args = p.parse_args()
    try:
        result = sync(args.left, args.right, args.state, json.loads(Path(args.files).read_text()), args.apply, args.initialize)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (OSError, ValueError, KeyError, UnicodeError) as error:
        p.exit(1, f'Sync stopped: {error}\n')


if __name__ == '__main__':
    main()
