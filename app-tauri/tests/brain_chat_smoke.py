import os, sys
from playwright.sync_api import sync_playwright

base = os.environ.get("PREVIEW_URL", "http://localhost:4173")
out_dir = os.path.join(os.path.dirname(__file__), "smoke-out")
os.makedirs(out_dir, exist_ok=True)

def shot(page, path, name):
    page.goto(f"{base}/#/{path}", wait_until="networkidle")
    page.wait_for_timeout(600)
    page.screenshot(path=os.path.join(out_dir, f"{name}.png"), full_page=False)
    logs = page.evaluate("() => { return window.__errors || []; }")
    return logs

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    page = ctx.new_page()
    page.evaluate("() => { window.__errors = []; window.addEventListener('error', e => window.__errors.push(e.message)); }")
    page.evaluate("() => { try { localStorage.setItem('or-onboarded', '1'); } catch(e){} }")

    routes = [
        ("chat", "chat"),
        ("brain", "brain"),
        ("compose", "compose"),
        ("queue", "queue"),
        ("brain/angle/People%20hate%20manual%20tagging%20of%20notes", "brain-angle"),
        ("compose?kind=article&angle=Test%20angle&context=Some%20context", "compose-article"),
    ]
    ok = True
    for path, name in routes:
        errs = shot(page, path, name)
        status = "ERRORS " + "; ".join(errs) if errs else "ok"
        print(f"{name}: {status}")
        if errs:
            ok = False

    browser.close()

sys.exit(0 if ok else 1)
