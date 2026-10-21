import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const tasksUrl = new URL("../src/tabs/Tasks.jsx", import.meta.url);
const appUrl = new URL("../src/App.jsx", import.meta.url);
const taskInfoBarUrl = new URL("../src/TaskInfoBar.jsx", import.meta.url);
const taskInfoBarStylesUrl = new URL("../src/TaskInfoBar.css", import.meta.url);
const tasksStylesUrl = new URL("../src/tabs/Tasks.css", import.meta.url);

test("loaded task path reaches the task bar", async () => {
    const [tasksSource, appSource] = await Promise.all([
        readFile(tasksUrl, "utf8"),
        readFile(appUrl, "utf8"),
    ]);

    assert.match(
        tasksSource,
        /const commitTaskLoad = [\s\S]*?selectionService\.setLoadedTaskPath\(fullPath\);/u,
    );
    assert.match(
        appSource,
        /<TaskInfoBar[\s\S]*?path=\{selectionService\.loadedTaskPath\(\)\}/u,
    );
});

test("task path and confirmation use one successful-load signal", async () => {
    const [source, styles] = await Promise.all([
        readFile(tasksUrl, "utf8"),
        readFile(tasksStylesUrl, "utf8"),
    ]);

    assert.match(
        source,
        /const loadedTaskPath = selectionService\.loadedTaskPath;/u,
    );
    assert.match(source, /<Show keyed when=\{loadedTaskPath\(\)\}>/u);
    assert.doesNotMatch(source, /loadConfirmation|setLoadConfirmation/u);
    assert.match(source, /class="task-load-label"/u);
    assert.match(source, /class="task-load-leading"/u);
    assert.match(source, /class="task-load-text"/u);
    assert.match(source, /class="task-load-trailing"/u);
    assert.match(source, /class="task-load-confirmation"/u);
    assert.match(source, /aria-label="Задание загружено"/u);
    assert.match(
        styles,
        /\.task-load-confirmation\s*\{[^}]*position:\s*absolute;[^}]*right:\s*33\.333%;[^}]*color:\s*#ffd600;[^}]*font-weight:\s*900;[^}]*animation:\s*task-load-confirmation 3s/su,
    );
    assert.match(
        styles,
        /\.task-load-label\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\);/su,
    );
    assert.match(
        styles,
        /@keyframes task-load-confirmation\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?opacity:\s*1;/u,
    );
});

test("task-bar action buttons share height and the drawer button is accented", async () => {
    const styles = await readFile(taskInfoBarStylesUrl, "utf8");

    assert.match(
        styles,
        /\.validate-button,\s*\.save-button\s*\{[^}]*height:\s*26px;[^}]*padding:\s*3px 10px;/su,
    );
    assert.match(
        styles,
        /\.menu-button\s*\{[^}]*background:\s*#e6a23c;/su,
    );
    assert.match(
        styles,
        /\.menu-button:hover,[\s\S]*?\.menu-button\[aria-expanded="true"\]\s*\{[^}]*background:\s*#c98218;/su,
    );
});

test("loaded path is announced and softly highlighted once", async () => {
    const [source, styles] = await Promise.all([
        readFile(taskInfoBarUrl, "utf8"),
        readFile(taskInfoBarStylesUrl, "utf8"),
    ]);

    assert.match(source, /import \{ Show,/u);
    assert.match(source, /aria-live="polite"/u);
    assert.match(source, /aria-atomic="true"/u);
    assert.match(source, /<Show\s+keyed\s+when=\{props\.path\}/u);
    assert.match(source, /class="task-info-path-empty"/u);
    assert.match(source, /class="task-info-path-value"/u);

    const keyframes = styles.match(
        /@keyframes task-path-attention\s*\{[\s\S]*?\n\}/u,
    )?.[0] ?? "";
    // Ограничение относится к пути задания. Кнопка сохранения пульсирует
    // всё время своей асинхронной операции в этой же таблице стилей.
    const pathStyles = styles.match(
        /\.task-info-path(?:-value|-empty)?[^{}]*\{[^{}]*\}/gu,
    )?.join("\n") ?? "";

    assert.match(
        styles,
        /\.task-info-path-value\s*\{[^}]*animation:\s*task-path-attention 3s ease-in-out;/su,
    );
    assert.match(
        keyframes,
        /0%,\s*100%\s*\{[^}]*color:\s*#000;[^}]*background-color:\s*transparent;[^}]*\}\s*50%\s*\{[^}]*color:\s*#b00020;[^}]*background-color:\s*rgba\(255, 235, 59, \.72\);/su,
    );
    assert.doesNotMatch(keyframes, /rgba\(144, 211, 156/u);
    assert.doesNotMatch(
        pathStyles,
        /animation(?:-[\w-]+)?\s*:[^;]*(?:infinite|transform)/u,
    );
    assert.doesNotMatch(keyframes, /transform\s*:/u);
    assert.match(
        styles,
        /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.task-info-path-value\s*\{\s*animation:\s*none;/u,
    );
});
