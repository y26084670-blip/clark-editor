#!/usr/bin/env python3
"""Portable regression checks using synthetic dimensions and the prescribed-source example."""
import copy
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"
EXAMPLE = ROOT / "examples" / "01_prescribed_source"


def run(*args, code=0):
    result = subprocess.run(args, text=True, capture_output=True, cwd=ROOT)
    if result.returncode != code:
        raise AssertionError(f"{args}: exit {result.returncode}, expected {code}\n{result.stdout}\n{result.stderr}")
    return json.loads(result.stdout) if result.stdout.strip() else None


def write_record(path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False) + "\n", encoding="utf-8")


class GridAndRam(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.tmp = Path(temp.name)
        self.plan = {"segments": [{"rank": 0, "matrix": "fm3", "rows": 360, "cols": 600}],
                     "reserve_gib": 0.125, "target_gib": 0.5}

    def ram(self, plan, code=0):
        p = self.tmp / "plan.json"
        write_record(p, plan)
        return run(sys.executable, str(TOOLS / "estimate_ram.py"), str(p), code=code)

    def case_copy(self):
        p = self.tmp / "case"
        shutil.copytree(EXAMPLE, p)
        return p

    def grid(self, *cases, code=0):
        return run("node", str(TOOLS / "grid_report.mjs"), *map(str, cases), code=code)

    def test_rectangular_operator_and_one_reserve(self):
        r = self.ram(self.plan)
        self.assertEqual(r["matrix_bytes"], 864000)
        self.assertEqual(r["estimate_bytes"], 864000 + 2**27)
        self.assertIsNone(r["measured_peak"])

    def test_both_precisions(self):
        stored = [self.ram({**self.plan, "real": real})["matrix_bytes"] for real in ("REAL32", "REAL64")]
        self.assertEqual(stored, [864000, 864000])

    def test_split_ranks_and_empty_segment(self):
        serial = self.ram(self.plan)
        self.plan["segments"] = [{"rank": rank, "matrix": "fm3", "rows": rows, "cols": 600}
                                 for rank, rows in enumerate((121, 239, 0))]
        self.assertEqual(self.ram(self.plan)["estimate_bytes"], serial["estimate_bytes"])

    def test_hard_limit_and_boundary(self):
        self.plan.update(limit_kind="hard", target_gib=0.125)
        self.assertTrue(self.ram(self.plan, code=1)["hard_limit_exceeded"])
        self.plan["segments"][0].update(rows=64, cols=1024)
        self.plan["target_gib"] = (2**27 + 64 * 1024 * 4) / 2**30
        self.assertTrue(self.ram(self.plan)["within_target"])

    def test_recommended_exceedance(self):
        r = self.ram({**self.plan, "target_gib": 0.125})
        self.assertFalse(r["within_target"])
        self.assertFalse(r["hard_limit_exceeded"])

    def test_invalid_allocations(self):
        self.ram({**self.plan, "segments": self.plan["segments"] * 2}, code=2)
        for value in (-4, 1.5, True):
            with self.subTest(value=value):
                p = copy.deepcopy(self.plan)
                p["segments"][0]["rows"] = value
                self.ram(p, code=2)

    def test_record_image_and_independent_counts(self):
        case = self.case_copy()
        kvs = case / "input3XX" / "kvs.txt"
        kv = json.loads(kvs.read_text())
        kv["sym"].update(ls=2, **{"as": 3}, ps=2, kya=1, kyp=0)
        virtual = {**kv, "targ": 3}
        kvs.write_text("\n".join(map(json.dumps, (kv, virtual))) + "\n")
        r = self.grid(case)
        self.assertEqual((r["kvRecords"], r["virtualKV"], r["physicalBlocksBeforeGlobalMirrors"]), (2, 1, 12))
        self.assertEqual((r["physicalSourceEO"], r["independentPrescribedM"]), (96, 32))

    def test_one_block_refines_with_prescribed_source(self):
        refined = self.case_copy()
        inp = refined / "input3XX"
        kv = json.loads((inp / "kvs.txt").read_text())
        kv["dp"] = [4, 4, 4]
        write_record(inp / "kvs.txt", kv)
        original = json.loads((EXAMPLE / "input3XX" / "mhj.txt").read_text())["v"]
        components = [original[8*i:8*i+8] for i in range(3)]
        self.assertTrue(all(len(set(c)) == 1 for c in components))
        write_record(inp / "mhj.txt", {"v": [c[0] for c in components for _ in range(64)]})
        self.assertTrue(run(sys.executable, str(TOOLS / "check_case.py"), str(refined))["valid"])
        r = self.grid(EXAMPLE, refined)
        self.assertTrue(r["sameBlocksAndAttributes"])
        self.assertEqual(r["changedDp"], [{"index": 1, "before": [2, 2, 2], "after": [4, 4, 4]}])
        self.assertEqual([r[s]["kvRecords"] for s in ("before", "after")], [1, 1])
        self.assertEqual([r[s]["independentPrescribedM"] for s in ("before", "after")], [8, 64])

    def test_geometry_and_global_symmetry_changes(self):
        case = self.case_copy()
        inp = case / "input3XX"
        kv = json.loads((inp / "kvs.txt").read_text())
        kv["geo"][0] += 0.25
        write_record(inp / "kvs.txt", kv)
        r = self.grid(EXAMPLE, case, code=1)
        self.assertEqual(r["changedOutsideDp"], [{"index": 1, "fields": ["geo"]}])
        shutil.copyfile(EXAMPLE / "input3XX" / "kvs.txt", inp / "kvs.txt")
        general = json.loads((inp / "general.txt").read_text())
        general["mirrorSymmetryX"] = 0
        write_record(inp / "general.txt", general)
        self.assertFalse(self.grid(EXAMPLE, case, code=1)["sameGlobalSymmetry"])

    def test_stale_mhj_after_refinement(self):
        case = self.case_copy()
        kvs = case / "input3XX" / "kvs.txt"
        kv = json.loads(kvs.read_text())
        kv["dp"] = [4, 4, 4]
        write_record(kvs, kv)
        r = run(sys.executable, str(TOOLS / "check_case.py"), str(case), code=1)
        self.assertTrue(any("MHJ length" in msg for msg in r["errors"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
