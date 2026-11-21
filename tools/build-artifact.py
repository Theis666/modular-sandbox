"""Bundle the app into one self-contained HTML body for publishing as a Claude Artifact (testing only).
Usage: python3 tools/build-artifact.py OUT.html
The real PWA is the folder itself; this bundle has no service worker or manifest."""
import re, sys, pathlib, json
root = pathlib.Path(__file__).resolve().parent.parent
# File order from the imports: every file comes after the files it imports, because the bundle
# runs as one script and a value used at the top level must already be defined.
IMPORT = re.compile(r"^import .*? from '\./([\w-]+)\.js';[ \t]*(//.*)?$", re.M)
order, state = [], {}
def visit(name):
    if state.get(name) == 'done': return
    if state.get(name) == 'busy': sys.exit(f'import cycle through {name}.js: the bundle cannot order it')
    state[name] = 'busy'
    for dep, _ in IMPORT.findall((root / 'js' / f'{name}.js').read_text()): visit(dep)
    state[name] = 'done'; order.append(name)
visit('app')
js = []
for name in order:
    src = (root / 'js' / f'{name}.js').read_text()
    src = IMPORT.sub('', src)
    left = [l for l in src.splitlines() if l.startswith('import ')]
    if left: sys.exit(f'{name}.js: import line the bundle cannot remove: {left[0]}')
    src = re.sub(r'^export (const|function|class|let) ', r'\1 ', src, flags=re.M)
    js.append(f'// ---- {name}.js ----\n{src}')
html = (root / 'index.html').read_text()
body = re.search(r'<body[^>]*>(.*)</body>', html, re.S).group(1)
body = re.sub(r'<script type="module" src="js/app.js"></script>', '', body)
css = (root / 'styles.css').read_text()
out = f'''<title>Modular Sandbox</title>
<meta name="theme-color" content="#141518">
<style>
{css}
</style>
<script>document.documentElement.style.background = '#121316'; document.body && (document.body.dataset.cables = '0');</script>
{body}
<script>window.__MSS_WORKLET = {json.dumps((root / 'js' / 'worklet.js').read_text())};</script>
<script type="module">
{chr(10).join(js)}
</script>
'''
pathlib.Path(sys.argv[1]).write_text(out)
print('wrote', sys.argv[1], len(out), 'bytes')
