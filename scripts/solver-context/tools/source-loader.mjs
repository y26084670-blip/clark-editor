import fs from "node:fs/promises";
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && context.parentURL) {
    const url = new URL(specifier, context.parentURL);
    if (!/\.(?:js|mjs|json|md|txt|css|jsx)$/i.test(url.pathname)) {
      for (const suffix of [".js", "/index.js"]) {
        const candidate = new URL(url); candidate.pathname += suffix;
        try { await fs.access(candidate); return { url: candidate.href, shortCircuit: true }; } catch {}
      }
    }
  }
  return nextResolve(specifier, context);
}
export async function load(url, context, nextLoad) {
  const u = new URL(url);
  if (u.protocol === "file:" && (u.search === "?raw" || u.pathname.endsWith(".json"))) {
    const raw = u.search === "?raw"; u.search = "";
    const text = await fs.readFile(u, "utf8");
    return { format: "module", source: "export default " + (raw ? JSON.stringify(text) : text) + ";", shortCircuit: true };
  }
  return nextLoad(url, context);
}
