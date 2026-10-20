import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('sync', Path(__file__).with_name('sync.py'))
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)

class SyncTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.left, self.right, self.state = [self.root / p for p in ['left', 'right', 'state']]
        self.name = 'projects/demo/STATUS.md'
        for root in [self.left, self.right]:
            (root / self.name).parent.mkdir(parents=True)
            (root / self.name).write_text('original')
        self.run_sync(apply=True, initialize=True)

    def run_sync(self, **kwargs):
        return sync.sync(self.left, self.right, self.state, [self.name], **kwargs)

    def test_preview_transfer_and_repeat(self):
        (self.left / self.name).write_text('new left')
        self.assertEqual(self.run_sync()['changes'][0]['action'], 'left-to-right')
        self.assertEqual((self.right / self.name).read_text(), 'original')
        self.run_sync(apply=True)
        self.assertEqual((self.right / self.name).read_text(), 'new left')
        self.assertEqual(self.run_sync(apply=True)['changes'], [])
        (self.right / self.name).write_text('new right')
        self.run_sync(apply=True)
        self.assertEqual((self.left / self.name).read_text(), 'new right')

    def test_conflict_and_repeat_preserve_both(self):
        (self.left / self.name).write_text('left changed')
        (self.right / self.name).write_text('right changed')
        self.assertEqual(self.run_sync(apply=True)['changes'][0]['action'], 'conflict')
        recovery = list((self.state / 'recovery').rglob('*'))
        self.run_sync(apply=True)
        self.assertEqual(recovery, list((self.state / 'recovery').rglob('*')))
        self.assertEqual({p.read_text() for p in recovery if p.is_file()}, {'left changed', 'right changed'})

    def test_delete_retained(self):
        (self.left / self.name).unlink()
        self.assertEqual(self.run_sync(apply=True)['changes'][0]['action'], 'missing-retained')
        self.assertEqual((self.right / self.name).read_text(), 'original')

    def test_disconnected_root_and_credential_fail_before_write(self):
        (self.right / self.name).write_text('right changed')
        (self.left / self.name).write_text('api_key=' + 'x' * 30)
        with self.assertRaises(ValueError): self.run_sync(apply=True)
        self.assertEqual((self.right / self.name).read_text(), 'right changed')
        self.left.rename(self.root / 'disconnected')
        with self.assertRaises(ValueError): self.run_sync(apply=True)
        self.assertFalse(self.left.exists())

    def test_project_log_is_content_but_runtime_logs_are_excluded(self):
        self.assertEqual(sync.check_path('projects/demo/log.md'), 'projects/demo/log.md')
        for name in ['projects/demo/runtime/log.md', 'projects/demo/debug.md', 'inbox/log.md']:
            with self.assertRaises(ValueError): sync.check_path(name)

    def test_scope_and_symlink(self):
        for path in ['phone/today.json', '.git/config', 'health/data.json', '../memory/a.md']:
            with self.assertRaises(ValueError): sync.check_path(path)
        (self.left / self.name).unlink()
        (self.left / self.name).symlink_to(self.right / self.name)
        with self.assertRaises(ValueError): self.run_sync(apply=True)

if __name__ == '__main__': unittest.main()
