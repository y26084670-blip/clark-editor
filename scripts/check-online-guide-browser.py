"""Optional browser checks: real Solid/Tabulator components, controlled file handles.
Requires Python, playwright, Chromium and the project's npm ci.
No production files are changed. Output goes to --out (default: a temporary directory).
Browser URL navigation/system file permissions are NOT claimed by this fixture.
"""
from pathlib import Path
import argparse, hashlib, json, os, shutil, subprocess, tempfile
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--out', type=Path, default=None)
args = parser.parse_args()
OUT = (args.out or Path(tempfile.mkdtemp(prefix='clark-guide-browser-'))).resolve()
OUT.mkdir(parents=True, exist_ok=True)
results = []
def check(name, condition, detail=None):
    results.append(dict(name=name, passed=bool(condition), **({'detail': detail} if detail is not None else {})))
    if not condition: print('FAIL:', name, detail)
def save():
    (OUT/'browser-tests.json').write_text(json.dumps({
        'checks': results, 'passed': sum(x['passed'] for x in results),
        'failed': sum(not x['passed'] for x in results),
        'scope': 'Chromium DOM/layout; real components; controlled file handles, SHA-256 bridge; inlined test bundle',
        'not_tested': ['native filesystem permissions and picker dialogs', 'Windows clark://', 'hosted site navigation'],
    }, ensure_ascii=False, indent=2), encoding='utf-8')

# An IIFE keeps the fixture offline: it is not included in the production entrypoint.
bundle = OUT/'bundle'
build_script = OUT/'build-fixture.mjs'
build_script.write_text(f"""import {{ build }} from {json.dumps((ROOT/'node_modules/vite/dist/node/index.js').as_uri())};
import solid from {json.dumps((ROOT/'node_modules/vite-plugin-solid/dist/esm/index.mjs').as_uri())};
await build({{ configFile:false, root:{json.dumps(str(ROOT))}, publicDir:false, plugins:[solid()], base:'/clark-editor/',
 build:{{outDir:{json.dumps(str(bundle))},emptyOutDir:true,minify:false,
 lib:{{entry:'test/browser/guideMaterials.fixture.jsx',name:'GuideMaterialsFixture',formats:['iife'],fileName:()=> 'fixture.js'}}}} }});
""", encoding='utf-8')
with (OUT/'fixture-build.log').open('w') as log:
    subprocess.run(['node', str(build_script)], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, check=True)
css = next(bundle.glob('*.css')).read_text(encoding='utf-8')
js = (bundle/'fixture.js').read_text(encoding='utf-8')

def ready(page):
    page.wait_for_function("guideMaterials.snapshot().busy === 'false'", timeout=15000)
def snap(page): return page.evaluate('guideMaterials.snapshot()')

guide = ROOT/'docs/user-guide'
with sync_playwright() as pw:
    executable = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('google-chrome')
    if not executable: raise RuntimeError('Set CHROMIUM_PATH to a Chromium executable.')
    browser = pw.chromium.launch(executable_path=executable, headless=True, args=['--no-sandbox'])
    try:
        for width in [390, 768, 1440]:
            page=browser.new_page(viewport={'width':width,'height':1000},reduced_motion='reduce')
            for filename in ['index.html','user.html','developer.html','theory.html']:
                page.goto((guide/filename).as_uri())
                check(f'guide-{width}:{filename}:heading',page.locator('h1').is_visible())
                check(f'guide-{width}:{filename}:no-overflow',page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
            page.goto((guide/'theory.html').as_uri()+'#model-integral')
            check(f'guide-{width}:equation-image',page.locator('img[data-equation="2"]').evaluate('(im)=>im.complete && im.naturalWidth > 0'))
            page.emulate_media(media='print')
            check(f'guide-{width}:print',not page.locator('.toc').is_visible() and page.locator('h1').is_visible())
            page.close()
        for kind in ['FMM', 'HTS']:
            context = browser.new_context(viewport={'width':1440,'height':1100})
            page=context.new_page(); errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.expose_function('__sha256', lambda data:list(hashlib.sha256(bytes(data)).digest()))
            page.set_content('<html><head><base href="https://fixture.invalid/clark-editor/"><style>'+css+'</style></head><body><div id="root"></div></body></html>')
            page.evaluate("""() => {
                Object.defineProperty(crypto,'subtle',{value:{digest:async(_algorithm,bytes)=>new Uint8Array(await window.__sha256(Array.from(new Uint8Array(bytes)))).buffer}});
                window.fetch=async url=> { if(String(url).endsWith('examples-config.json')) return new Response(JSON.stringify({manifestUrl:'examples-manifest.json',solverInstallerUrl:'https://example.invalid/installer'}),{status:200}); throw Error('Unexpected fixture fetch '+url); };
                window.sourceChanges=0; document.addEventListener('change',e=>{if(e.target.matches('.material-library-source select')) window.sourceChanges++;});
            }""")
            page.add_script_tag(content=js)
            page.evaluate('(kind)=>guideMaterials.mount(kind,"A")',kind); ready(page); page.evaluate('guideMaterials.setActive(true)')
            check(f'{kind}:task-present-before-table-ready',snap(page)['value']=='task' and snap(page)['rows'][0]['name']==f'TaskA_{kind}' and page.evaluate('guideMaterials.counters().baseCalls')==0)
            page.evaluate('guideMaterials.setTask(null)');ready(page)
            state=snap(page);check(f'{kind}:base-without-task',state['value']=='default' and state['rows'][0]['name']==f'BASE_{kind}' and not state['editable'],state)
            check(f'{kind}:local-option-first',page.locator('.material-library-source option').first.get_attribute('value')=='task')
            check(f'{kind}:local-disabled-without-task',page.locator('.material-library-source option').first.evaluate('(option)=>option.disabled'))
            page.evaluate("guideMaterials.setTask('A')");ready(page)
            state=snap(page);check(f'{kind}:auto-local-on-task',state['value']=='task' and state['rows'][0]['name']==f'TaskA_{kind}' and state['editable'],state)
            check(f'{kind}:no-synthetic-change-event',page.evaluate('sourceChanges')==0)
            select=page.locator('.material-library-source select')
            select.select_option('default');ready(page)
            check(f'{kind}:manual-base',snap(page)['rows'][0]['name']==f'BASE_{kind}' and not snap(page)['editable'])
            count=page.evaluate('guideMaterials.counters().baseCalls')
            page.evaluate('guideMaterials.setActive(false)');page.evaluate('guideMaterials.setActive(true)')
            check(f'{kind}:manual-choice-retained-on-tab-return',snap(page)['value']=='default' and page.evaluate('guideMaterials.counters().baseCalls')==count)
            page.evaluate("guideMaterials.setTask('B')");ready(page)
            check(f'{kind}:new-task-resets-local',snap(page)['rows'][0]['name']==f'TaskB_{kind}')
            page.evaluate("guideMaterials.setTask('A')");ready(page)
            check(f'{kind}:revisit-A-does-not-restore-old-base',snap(page)['value']=='task' and snap(page)['rows'][0]['name']==f'TaskA_{kind}')
            # A local read starts before the table is visible or fully rendered.
            page.evaluate('guideMaterials.delay("local")');page.evaluate("guideMaterials.setTask('B')")
            check(f'{kind}:pending-local-is-hidden-and-readonly',snap(page)['value']=='task' and not snap(page)['editable'] and page.locator('.material-library-table').evaluate('(e)=>getComputedStyle(e).visibility')=='hidden')
            page.evaluate('guideMaterials.release("local")');ready(page)
            check(f'{kind}:delayed-local-applied',snap(page)['rows'][0]['name']==f'TaskB_{kind}')
            # A late base read cannot overwrite a subsequent local choice.
            calls=page.evaluate('guideMaterials.counters().baseCalls')
            completed=page.evaluate('guideMaterials.counters().baseCompleted')
            page.evaluate('guideMaterials.delay("base")');select.select_option('default')
            page.wait_for_function('(previous)=>guideMaterials.counters().baseCalls>previous',arg=calls)
            page.evaluate("guideMaterials.setTask('A')");ready(page)
            page.evaluate('guideMaterials.release("base")');page.wait_for_function('(previous)=>guideMaterials.counters().baseCompleted>previous',arg=completed)
            check(f'{kind}:late-base-discarded',snap(page)['value']=='task' and snap(page)['rows'][0]['name']==f'TaskA_{kind}')
            # A Tabulator setData already in flight is serialized before the new clear/setData.
            page.evaluate('guideMaterials.delayRender()');select.select_option('default');page.wait_for_function('guideMaterials.renderWaiting()')
            select.select_option('task')
            check(f'{kind}:pending-render-readonly',not snap(page)['editable'])
            page.evaluate('guideMaterials.releaseRender()');ready(page)
            check(f'{kind}:late-render-cannot-win',snap(page)['rows'][0]['name']==f'TaskA_{kind}')
            calls=page.evaluate('guideMaterials.counters().baseCalls')
            page.evaluate("guideMaterials.setTask('empty')");ready(page)
            check(f'{kind}:empty-stays-local',snap(page)['value']=='task' and not snap(page)['rows'] and page.get_by_text('отсутствует или пуста.',exact=False).is_visible() and page.evaluate('guideMaterials.counters().baseCalls')==calls)
            page.evaluate("guideMaterials.setTask('denied')")
            page.wait_for_function("document.querySelector('.material-library-error')?.textContent.includes('Test permission denied')")
            check(f'{kind}:access-error-no-fallback',snap(page)['value']=='task' and not snap(page)['editable'] and page.evaluate('guideMaterials.counters().baseCalls')==calls)
            select.select_option('default');ready(page)
            check(f'{kind}:manual-base-after-error',snap(page)['rows'][0]['name']==f'BASE_{kind}')
            page.evaluate("guideMaterials.setTask('A')");ready(page)
            if kind=='FMM':
                cell=page.locator('.material-library-table .tabulator-row .tabulator-cell[tabulator-field="hip"]').first
                cell.dblclick();cell.locator('input').fill('0.5');cell.locator('input').press('Enter')
                page.wait_for_function("guideMaterials.snapshot().rows[0].hip===0.5")
                page.once('dialog',lambda dialog:dialog.dismiss());select.select_option('default')
                check('FMM:cancel-source-switch-preserves-dirty',snap(page)['value']=='task' and snap(page)['rows'][0]['hip']==0.5)
                page.evaluate('guideMaterials.history("undo")');page.wait_for_function('guideMaterials.snapshot().rows[0].hip===0')
                page.evaluate('guideMaterials.history("redo")');page.wait_for_function('guideMaterials.snapshot().rows[0].hip===0.5')
                check('FMM:history-still-works',snap(page)['rows'][0]['hip']==0.5)
                page.get_by_role('button',name='Сохранить',exact=True).click();ready(page)
                page.wait_for_function('guideMaterials.counters().writes.length>0')
                check('FMM:save-writes-only-local-fixture',page.evaluate('guideMaterials.counters().writes')==['TaskA_FMM.txt'])
            page.screenshot(path=str(OUT/f'local-{kind}.png'))
            check(f'{kind}:serialized-table-queue',page.evaluate('guideMaterials.queueRegression()')=='task')
            page.evaluate('guideMaterials.setHelp(true)')
            check(f'{kind}:old-help-link-removed',page.locator('.general-information-guide-link').count()==0)
            page.screenshot(path=str(OUT/f'general-information-{kind}.png'))
            page.set_viewport_size({'width':390,'height':844})
            check(f'{kind}:help-heading-narrow-visible',page.locator('#general-information-title').is_visible())
            check(f'{kind}:no-page-errors',not errors,errors)
            context.close()
    except Exception as error:
        check('browser-run-completed',False,str(error))
        raise
    finally:
        save();browser.close()
print(f"Browser checks: {sum(r['passed'] for r in results)} passed / {sum(not r['passed'] for r in results)} failed; {OUT}")
raise SystemExit(1 if any(not r['passed'] for r in results) else 0)
