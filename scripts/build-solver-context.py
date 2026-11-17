"""Build the public CLARK context ZIPs from pinned Editor commits and teaching sources."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

REPO = Path(__file__).resolve().parents[1]
SOURCE = REPO / "scripts" / "solver-context"
DATE = "2026-11-17"
RELEASES = [
    ("1.0", "4.114.3", "1.7", "aff00360d92d60275781c19854c5b4dbdd3393c5"),
    ("1.1", "4.114.4", "1.8", "a60904c57235f26189f67c25b7cc5173f0ba05b5"),
]
GRID_TOOLS = {"grid_report.mjs", "estimate_ram.py", "test_grid_ram.py"}
REFERENCE = ("AI_CLARK_INTEGRATION.md", "AI_DATA_CONTRACTS.md", "AI_GEOMETRY_GENERATION.md")


def git(*args):
    return subprocess.check_output(["git", *args], cwd=REPO)


def put(file, data):
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_bytes(data.encode("utf-8") if isinstance(data, str) else data)


def json_file(file, value):
    put(file, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def native(root, tool, *args):
    return subprocess.check_output(["node", "--no-warnings", "--loader", "./tools/source-loader.mjs",
                                    "tools/" + tool, *map(str, args)], cwd=root)


def vertices(x0, x1, y0, y1, z0, z1):
    return [value for z in (z0, z1) for y in (y0, y1) for x in (x0, x1) for value in (x, y, z)]


def create_example(root, temporary, schemas, contact):
    name = "02_contact_geometry" if contact else "01_prescribed_source"
    draft = temporary / "draft" / name
    result = root / "examples" / name
    records = {}
    for schema in schemas:
        sample = schema["exampleOnlyNotTask"]
        records[schema["file"]] = ([json.loads(sample)] if schema["storage"] == "cluster"
                                   else [json.loads(row) for row in sample.splitlines()])
    general = records["general.txt"][0]
    general.update(useMED=True, doubleFloat=True, fullAxialSymmetry=False, mirrorSymmetryX=-1,
                   mirrorSymmetryY=-1, countTimeSteps=0, timeStep=0, evalForce=False, htsMu=False, htsRo=False)
    symmetry = dict(vi=[0, 0, 0], r0=[0, 0, 0], yl=0, ya=0, tx=0, ls=1, ps=1, kya=0, kyp=0)
    symmetry["as"] = 1
    kv = records["kvs.txt"][0]
    kv.update(geoType=0, sym=symmetry, med=[-1] * 6, targ=1, model=0, xapName="", take=0, rv=0)
    records["amplitudes.txt"] = []
    records["moves.txt"] = []
    if contact:
        # Blocks meet over full faces. A2 and B have an edge in common.
        blocks = [
            ("A1", (0, 12, 0, 4, 0, 4), [6, 2, 2], [-1, -1, -1, 2, -1, 3]),
            ("A2", (0, 12, 4, 8, 0, 4), [6, 2, 2], [-1, -1, 1, -1, -1, -1]),
            ("B", (12, 18, 0, 4, 0, 4), [3, 2, 2], [-1, -1, -1, -1, 1, -1]),
        ]
        records["kvs.txt"] = [dict(kv, name=label, geo=vertices(*bounds), dp=grid, med=neighbours,
                                   targ=0, rv=2) for label, bounds, grid, neighbours in blocks]
        records["mhj.txt"] = [{"v": []}]
        records["tks.txt"] = []
        description = ("Учебный частичный контакт. Слева тело A размером 12×8×4 мм, справа B размером "
                       "6×4×4 мм. Разрез левого тела на A1 и A2 даёт полную контактную грань A1/B. "
                       "Шаг сетки 2 мм, три ШГ, 60 ЭО, общий объём 480 мм³. Проводимость 2 МСм/м "
                       "задана для примера. Для расчёта физического режима требуется задать возбуждение.")
        put(draft / "DOCS/source-sketch.svg", (SOURCE / "contact-sketch.svg").read_text(encoding="utf-8"))
    else:
        kv.update(name="Иллюстративный заданный M", geo=vertices(0, 10, 0, 10, 0, 10), dp=[2, 2, 2])
        records["mhj.txt"] = [{"v": [0] * 16 + [800] * 8}]
        records["tks.txt"][0].update(name="Плоскость наблюдения X=15 мм", geoType=0, sym=symmetry,
            geo=[15, -10, -10, 15, 10, -10, 15, 10, 10, 15, -10, 10], dp=[5, 5])
        description = ("Учебный куб 10×10×10 мм. Один ШГ с разбиением 2×2×2 даёт восемь ЭО. "
                       "Во всех ЭО задана M=(0,0,800) кА/м. Плоскость наблюдения X=15 мм, по Y и Z "
                       "от −10 до +10 мм, 5×5 узлов. Статика и свободное пространство.")
    put(draft / "DOCS/README.txt", description + "\nФайлы проверены штатной геометрией и сериализатором Editor. "
        "Откройте задачу, проверьте и сохраните. Расчёт поля в комплект не входит.\n")
    for filename, rows in records.items():
        text = "".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in rows)
        put(draft / "input3XX" / filename, text)
    native(root, "normalize_case.mjs", draft, result)
    structure = subprocess.check_output([sys.executable, "tools/check_case.py", str(result)], cwd=root)
    geometry = native(root, "check_geometry.mjs", result)
    for filename, data in (("structure-validation.json", structure), ("geometry-validation.json", geometry)):
        report = json.loads(data)
        if not report["valid"]:
            raise ValueError(f"Invalid {name}: {filename}")
        json_file(result / "DOCS" / filename, report)


def build(root, version, editor, profile, commit):
    pinned = {}
    def copy_pinned(dest, source):
        put(root / dest, git("show", f"{commit}:{source}"))
        pinned[dest] = source

    for path in (SOURCE / "runtime-files.txt").read_text(encoding="utf-8").splitlines():
        copy_pinned("runtime/editor/" + path, path)
    for name in REFERENCE:
        copy_pinned("reference/" + name, "docs/" + name)
    guide_paths = git("ls-tree", "-r", "-z", "--name-only", commit, "docs/user-guide").decode().split("\0")
    for path in filter(None, guide_paths):
        copy_pinned("reference/" + path.removeprefix("docs/"), path)
    for path in sorted((SOURCE / "tools").iterdir()):
        if path.is_file() and (version != "1.0" or path.name not in GRID_TOOLS):
            put(root / "tools" / path.name, path.read_text(encoding="utf-8"))
    ram = (SOURCE / "text/RAM.md").read_text(encoding="utf-8").strip() + "\n" if version != "1.0" else ""
    for filename in ("START.txt", "AI_SOLVER_CONTEXT.md", "AI_FEM_IMPORT.md", "README.md"):
        text = (SOURCE / "text" / filename).read_text(encoding="utf-8")
        for key, value in (("VERSION", version), ("EDITOR", editor), ("PROFILE", profile), ("RAM_SECTION", ram)):
            text = text.replace("{" + key + "}", value)
        put(root / filename, text)
    for path in sorted((SOURCE / "fem-square").iterdir()):
        put(root / "examples/03_fem_square" / path.name, path.read_text(encoding="utf-8"))
    (root / "schemas").mkdir()
    native(root, "export_contract.mjs")
    contract = json.loads((root / "schemas/storage-contract.json").read_bytes())
    if contract["editorVersion"] != editor:
        raise ValueError(f"Expected Editor {editor}, got {contract['editorVersion']}")
    for contact in (False, True):
        create_example(root, root.parent, contract["schemas"], contact)
    profile_file = "runtime/editor/data/ai-context/AI_SKETCH_CONTEXT.md"
    json_file(root / "source-lock.json", {
        "edition": "public", "version": version, "editorVersion": editor, "sketchProfileVersion": profile,
        "repository": "https://github.com/y26084670-blip/clark-editor", "editorCommit": commit,
        "profileSha256": digest((root / profile_file).read_bytes()), "publicRepositoryFiles": dict(sorted(pinned.items())),
        "buildRecipe": "scripts/build-solver-context.py", "teachingSources": "scripts/solver-context/",
        "generated": {"schemas": "Native Editor schema and geometry export",
                      "examples/01_prescribed_source": "Synthetic 10 mm prescribed cube",
                      "examples/02_contact_geometry": "Synthetic three-block partial contact",
                      "examples/03_fem_square": "Synthetic ASCII Gmsh 2.2 square"},
    })
    entries = {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob("*") if p.is_file()}
    json_file(root / "manifest.json", {"version": version, "edition": "public", "excludedSelf": "manifest.json",
        "files": [{"path": path, "size": len(data), "sha256": digest(data)} for path, data in sorted(entries.items())]})
    entries["manifest.json"] = (root / "manifest.json").read_bytes()
    name = f"Solver_Context_v{version}_public_{DATE}"
    stream = io.BytesIO()
    with ZipFile(stream, "w") as archive:
        for path, data in sorted(entries.items()):
            entry = ZipInfo(f"{name}/{path}", (2026, 11, 17, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, data, compress_type=ZIP_DEFLATED, compresslevel=9)
    return name + ".zip", stream.getvalue()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="compare with tracked ZIPs without writing")
    args = parser.parse_args()
    targets = {}
    for release in RELEASES:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "context"
            name, data = build(root, *release)
        targets[REPO / "context/archives" / name] = data
        if release == RELEASES[-1]:
            targets[REPO / "docs/user-guide/context" / name] = data
    for target, data in targets.items():
        if args.check:
            if target.read_bytes() != data:
                raise SystemExit(f"Archive differs: {target}")
        else:
            put(target, data)
        print(f"{target.relative_to(REPO)}  {len(data)} bytes  SHA-256 {digest(data)}")


if __name__ == "__main__":
    main()
