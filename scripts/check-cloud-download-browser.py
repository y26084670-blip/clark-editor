"""Check both Pages builds with Playwright and an isolated local project disk."""
import hashlib
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import expect, sync_playwright


EDITOR = Path(__file__).resolve().parents[1]
VIEWER = Path(os.environ.get("VIEWER_ROOT", EDITOR.parent / "clark-viewer")).resolve()
SITES = {"clark-editor": EDITOR / "dist", "clark-viewer": VIEWER / "dist"}
CATALOG = "clark.task.tests"
LOCAL = CATALOG + "_cloud"
PROJECT = "Полный ток"
TASK = "ПМ_sin_50Гц_длинная_по_X_2D"
TITLE = "Локальная загрузка выделенного облачного проекта"


class SitesHandler(SimpleHTTPRequestHandler):
    def translate_path(self, url):
        parts = Path(super().translate_path(url)).relative_to(self.directory).parts
        if parts and parts[0] in SITES:
            return str(SITES[parts[0]].joinpath(*parts[1:]))
        return str(EDITOR / "dist" / "__missing__")

    def log_message(self, *args):
        pass


SETUP = """
localStorage.setItem("e3d.generalInformation.openAtStartup", "false");
window.testDisk = async () => (await navigator.storage.getDirectory()).getDirectoryHandle("Диск", {create: true});
window.showDirectoryPicker = async () => {
    const disk = await testDisk();
    await disk.getDirectoryHandle("clark.task.tests_cloud", {create: true});
    return disk;
};
window.queueBytes = async catalog => {
    const root = await (await testDisk()).getDirectoryHandle(catalog);
    try {
        const handle = await root.getFileHandle("clark.tasks.txt");
        return Array.from(new Uint8Array(await (await handle.getFile()).arrayBuffer()));
    } catch (error) {
        if (error.name === "NotFoundError") return null;
        throw error;
    }
};
"""
HASH_FILES = """
async parts => {
    let dir = await testDisk();
    for (const part of parts) dir = await dir.getDirectoryHandle(part);
    const files = {};
    async function visit(folder, prefix) {
        for await (const [name, handle] of folder.entries()) {
            if (handle.kind === "directory") {
                await visit(handle, prefix + name + "/");
            } else {
                const bytes = await (await handle.getFile()).arrayBuffer();
                const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
                files[prefix + name] = Array.from(hash, b => b.toString(16).padStart(2, "0")).join("");
            }
        }
    }
    await visit(dir, "");
    return files;
}
"""


def check_app(browser, origin, app, expected):
    context = browser.new_context(viewport={"width": 1500, "height": 900})
    try:
        context.add_init_script(SETUP)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(f"{origin}/clark-{app}/")
        access = page.get_by_role("dialog", name="Доступ к проектам")
        access.get_by_label("Облачные примеры").select_option("cloud:" + CATALOG)
        queue_before = ("\ufeff*" + PROJECT + "/" + TASK + "\r\n").encode("utf-8")
        copy_name = TASK + " — копия"

        for name in (TASK, copy_name):
            if name == copy_name:
                page.locator("#projectCatalog").select_option("cloud:" + CATALOG)
            page.locator("#listProject").select_option(PROJECT)
            page.locator(".task-status-row").filter(has_text=TASK).click()
            page.get_by_role("button", name="Загрузить", exact=True).click()
            dialog = page.get_by_role("dialog", name=TITLE, exact=True)
            expect(dialog.get_by_role("checkbox")).to_have_count(0)
            if name == TASK:
                dialog.get_by_role("button", name="Выбрать диск").click()
            dialog.get_by_label("Локальный каталог с проектами", exact=True).fill(LOCAL)
            apply = dialog.get_by_role("button", name="Применить")
            apply.click()
            if name == copy_name:
                expect(dialog.get_by_label("Имя задания")).to_have_value(copy_name)
                apply.click()
            expect(dialog).not_to_be_visible(timeout=30000)
            expect(page.locator("#projectCatalog")).to_have_value(LOCAL)
            expect(page.locator(".task-status-row.selected")).to_contain_text(name)
            action = "Загрузить для редактирования" if app == "editor" else "Загрузить для просмотра"
            expect(page.get_by_role("button", name=action, exact=True)).to_be_enabled()
            assert page.evaluate(HASH_FILES, [LOCAL, PROJECT, name]) == expected

            saved = page.evaluate("catalog => queueBytes(catalog)", LOCAL)
            if name == TASK:
                assert saved is None, "Downloading must not create clark.tasks.txt"
                page.evaluate("""async ([catalog, bytes]) => {
                    const root = await (await testDisk()).getDirectoryHandle(catalog);
                    const file = await root.getFileHandle("clark.tasks.txt", {create: true});
                    const stream = await file.createWritable();
                    await stream.write(new Uint8Array(bytes));
                    await stream.close();
                }""", [LOCAL, list(queue_before)])
            else:
                assert bytes(saved) == queue_before, "Downloading changed an existing clark.tasks.txt"

        if app == "editor":
            page.get_by_role("button", name="Формирование списка заданий и запуск приложений").click()
            queue = page.get_by_role("list", name="Список заданий для расчета")
            row = page.locator(".task-status-row.selected")
            transfer = page.evaluate_handle("new DataTransfer()")
            row.dispatch_event("dragstart", {"dataTransfer": transfer})
            queue.dispatch_event("dragover", {"dataTransfer": transfer})
            queue.dispatch_event("drop", {"dataTransfer": transfer})
            row.dispatch_event("dragend", {"dataTransfer": transfer})
            expect(queue).to_contain_text(copy_name)
            saved = bytes(page.evaluate("catalog => queueBytes(catalog)", LOCAL)).decode("utf-8-sig")
            assert saved.splitlines() == ["*" + PROJECT + "/" + TASK, PROJECT + "/" + copy_name]
        assert not errors, errors
        print(f"{app}: both copies match all {len(expected)} files, queue checks passed", flush=True)
    finally:
        context.close()


def main():
    for site in SITES.values():
        if not (site / "index.html").is_file():
            raise SystemExit(f"Run npm run build:pages first in {site.parent}")
    source = EDITOR / "public" / "examples" / CATALOG / PROJECT / TASK
    expected = {f.relative_to(source).as_posix(): hashlib.sha256(f.read_bytes()).hexdigest()
                for f in source.rglob("*") if f.is_file()}
    assert expected, f"Missing example {source}"
    with ThreadingHTTPServer(("127.0.0.1", 0), partial(SitesHandler, directory=EDITOR)) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(executable_path=os.getenv("CHROMIUM_EXECUTABLE"))
                try:
                    for app in ("editor", "viewer"):
                        check_app(browser, f"http://127.0.0.1:{server.server_port}", app, expected)
                finally:
                    browser.close()
        finally:
            server.shutdown()


if __name__ == "__main__":
    main()
