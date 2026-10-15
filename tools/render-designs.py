"""Export existing Kaitu design files as inert, standalone website previews."""
from pathlib import Path
from html.parser import HTMLParser
from html import escape
import json
import re
import subprocess

import sys

if len(sys.argv) != 2:
    raise SystemExit('Usage: python3 tools/render-designs.py /path/to/rensheng-kaitu')
SOURCE = Path(sys.argv[1]).resolve()
OUTPUT = Path(__file__).resolve().parents[1] / 'previews'
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}

class Parser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = ['root', {}, []]
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = [tag, dict(attrs), []]
        self.stack[-1][2].append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for index in range(len(self.stack)-1, 0, -1):
            if self.stack[index][0] == tag:
                self.stack = self.stack[:index]
                break

    def handle_data(self, data):
        self.stack[-1][2].append(data)

def value(expression, scope):
    result = scope
    for part in expression.strip().split('.'):
        if isinstance(result, dict):
            result = result.get(part, '')
        else:
            return ''
    return result

def interpolate(text, scope):
    return re.sub(r'{{\s*([^}]+)\s*}}', lambda m: str(value(m[1], scope)), text)

def render(node, scope):
    if isinstance(node, str):
        return escape(interpolate(node, scope), quote=False)
    tag, attrs, children = node
    if tag == 'sc-if':
        expression = attrs.get('value', '').strip('{} ')
        return ''.join(render(c, scope) for c in children) if value(expression, scope) else ''
    if tag == 'sc-for':
        expression = attrs.get('list', '').strip('{} ')
        values = value(expression, scope)
        return ''.join(render(c, {**scope, attrs['as']: item}) for item in values for c in children)
    if tag in ('root', 'x-dc', 'helmet'):
        return ''.join(render(c, scope) for c in children)
    if tag in ('script', 'head'):
        return ''
    attrs = {k: interpolate(v or '', scope) for k, v in attrs.items() if not k.startswith('on')}
    if tag == 'a':
        attrs.pop('href', None)
    if tag == 'button':
        attrs['disabled'] = ''
        attrs['tabindex'] = '-1'
    if tag == 'style':
        return '<style>' + ''.join(str(c) for c in children) + '</style>'
    attributes = ''.join(f' {k}="{escape(v, quote=True)}"' for k,v in attrs.items())
    body = ''.join(render(c, scope) for c in children)
    return f'<{tag}{attributes}>' + ('' if tag in VOID else body+f'</{tag}>')

OUTPUT.mkdir(exist_ok=True)
for slug in ('overview', 'health', 'doing', 'news', 'me'):
    path = SOURCE / 'docs' / 'design' / f'{slug}.dc.html'
    original = path.read_text()
    script = re.search(r'<script type="text/x-dc"[^>]*>([\s\S]*?)</script>', original)[1]
    vm_script = '''const vm=require('node:vm');let src='';process.stdin.on('data',c=>src+=c);process.stdin.on('end',()=>{const ctx=vm.createContext({DCLogic:class{constructor(props){this.props=props;}}}); const val=vm.runInContext(src+';new Component({}).renderVals()',ctx,{timeout:1000});process.stdout.write(JSON.stringify(val));});'''
    scope = json.loads(subprocess.check_output(['node', '-e', vm_script], input=script, text=True))
    parser = Parser()
    parser.feed(re.search(r'<x-dc>([\s\S]*?)</x-dc>', original)[1])
    content = render(parser.root, scope)
    assert '{{' not in content, path
    document = f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>开图界面设计示意</title><style>html{{background:#FCFCFB}}body{{margin:0;min-width:1120px}}button:disabled{{opacity:1;cursor:default}}a{{cursor:default}}*{{box-sizing:border-box}}</style></head><body><!-- Existing design: docs/design/{slug}.dc.html, synthetic examples only. -->{content}</body></html>'''
    (OUTPUT / f'{slug}.html').write_text(document)
    print(f'{slug}: exported original design ({len(document)} characters)')
