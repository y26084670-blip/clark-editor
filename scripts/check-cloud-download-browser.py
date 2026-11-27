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


def check_action_layout(page):
    dimensions = page.locator(".cloud-task-actions").evaluate("""pair => {
        const standard = pair.parentElement.querySelector(":scope > button");
        const row = pair.parentElement.parentElement;
        const width = row.style.width;
        try {
            return [320, 360, 430, 590, 760].map(size => {
                row.style.width = size + "px";
                const base = standard.getBoundingClientRect(), cloud = pair.getBoundingClientRect();
                const first = pair.firstElementChild, lines = first.querySelectorAll("span");
                return {
                    sameSize: base.width === cloud.width && base.height === cloud.height,
                    fits: [...pair.children].every(b => b.scrollWidth <= b.clientWidth + 1 && b.scrollHeight <= b.clientHeight + 1),
                    wrapped: lines[1].getBoundingClientRect().top > lines[0].getBoundingClientRect().top + 2,
                    smaller: parseFloat(getComputedStyle(lines[0]).fontSize) < parseFloat(getComputedStyle(first).fontSize)
                };
            });
        } finally { row.style.width = width; }
    }""")
    assert all(size["sameSize"] and size["fits"] for size in dimensions), dimensions
    assert dimensions[0]["wrapped"] and dimensions[0]["smaller"], dimensions
    assert not dimensions[-1]["wrapped"] and not dimensions[-1]["smaller"], dimensions


def check_app(browser, origin, app, expected):
    context = browser.new_context(viewport={"width": 1500, "height": 900})
    try:
        context.add_init_script(SETUP)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(f"{origin}/clark-{app}/")
        access = page.get_by_role("dialog", name="Доступ к проектам")
        expect(access.get_by_label("Облачные примеры")).to_have_count(0)
        access.get_by_role("button", name="Закрыть", exact=True).click()
        expect(page.get_by_role("button", name="Доступ к проектам", exact=True)).to_have_count(0)
        page.locator("#projectCatalog").select_option("cloud:" + CATALOG)
        queue_before = ("\ufeff*" + PROJECT + "/" + TASK + "\r\n").encode("utf-8")
        copy_name = TASK + " — копия"

        for name in (TASK, copy_name):
            if name == copy_name:
                page.locator("#projectCatalog").select_option("cloud:" + CATALOG)
            page.locator("#listProject").select_option(PROJECT)
            page.locator(".task-status-row").filter(has_text=TASK).click()
            if name == TASK:
                check_action_layout(page)
            page.get_by_role("button", name="Загрузить на локальный диск", exact=True).click()
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



def check_reading(browser, origin):
    context = browser.new_context(viewport={"width": 1500, "height": 900})
    try:
        context.add_init_script(SETUP)
        pages = {}
        errors = []
        for app in ("editor", "viewer"):
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(f"{origin}/clark-{app}/")
            access = page.get_by_role("dialog", name="Доступ к проектам")
            access.get_by_role("button", name="Закрыть", exact=True).click()
            pages[app] = page
        editor, viewer = pages["editor"], pages["viewer"]
        editor.locator("#projectCatalog").select_option("cloud:" + CATALOG)
        editor.locator("#listProject").select_option(PROJECT)
        editor.locator(".task-status-row").filter(has_text=TASK).click()
        editor.get_by_role("button", name="Выбрать в Viewer").click()
        expect(viewer.locator(".task-status-row.selected")).to_contain_text(TASK)
        expect(viewer.locator("#projectCatalog")).to_have_value("cloud:" + CATALOG)

        # Change the receiver's selection before testing the return command.
        editor.locator("#listProject").select_option("")
        viewer.get_by_role("button", name="Выбрать в Editor").click()
        expect(editor.locator(".task-status-row.selected")).to_contain_text(TASK)

        result_files = []
        viewer.on("response", lambda response: result_files.append(response.url) if response.ok and response.url.endswith(".h5") else None)
        viewer.get_by_role("button", name="Открыть для чтения", exact=True).click()
        expect(viewer.get_by_role("button", name="Источники / Поле 3D", exact=True)).to_have_attribute("aria-current", "page", timeout=45000)
        assert any(url.endswith("/JE.h5") for url in result_files), result_files
        viewer.get_by_role("button", name="Графики", exact=True).click()
        expect(viewer.get_by_role("button", name="Графики", exact=True)).to_have_attribute("aria-current", "page")
        editor.get_by_role("button", name="Открыть для чтения", exact=True).click()
        expect(editor.locator(".task-info-path")).to_contain_text(LOCAL + "/" + PROJECT + "/" + TASK)
        expect(editor.locator(".save-button")).to_be_disabled()
        editor.locator('button[data-tab-id="elements"]').click()
        section = editor.locator(".tab-content:visible")
        section.locator(".data-editor-main-table .tabulator-row").first.click()
        expect(section.locator('input[data-field="dp"]').first).to_have_attribute("readonly", "")
        expect(section.locator('.record-card-pair select').first).to_be_disabled()
        editor.locator('button[data-tab-id="tasks"]').click()
        editor.get_by_role("button", name="Загрузить на локальный диск").click()
        dialog = editor.get_by_role("dialog", name=TITLE)
        dialog.get_by_role("button", name="Выбрать диск").click()
        dialog.get_by_label("Локальный каталог с проектами", exact=True).fill(LOCAL)
        dialog.get_by_role("button", name="Применить").click()
        expect(editor.locator("#projectCatalog")).to_have_value(LOCAL)
        editor.get_by_role("button", name="Загрузить для редактирования").click()
        expect(editor.locator(".task-info-path")).not_to_contain_text("только чтение")
        expect(editor.locator(".save-button")).to_be_enabled()
        editor.locator('button[data-tab-id="elements"]').click()
        section = editor.locator(".tab-content:visible")
        section.locator(".data-editor-main-table .tabulator-row").first.click()
        expect(section.locator('.record-card-pair select').first).to_be_enabled()
        viewer.get_by_role("button", name="Выбор задания", exact=True).click()
        viewer.get_by_role("button", name="Выбрать в Editor").click()
        expect(editor.locator("#projectCatalog")).to_have_value("cloud:" + CATALOG)
        expect(editor.locator(".task-status-row.selected")).to_contain_text(TASK)
        assert not errors, errors
        print("Editor cloud input, Viewer results and selection in both directions passed", flush=True)
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
                    check_reading(browser, f"http://127.0.0.1:{server.server_port}")
                    for app in ("editor", "viewer"):
                        check_app(browser, f"http://127.0.0.1:{server.server_port}", app, expected)
                finally:
                    browser.close()
        finally:
            server.shutdown()


if __name__ == "__main__":
    main()
