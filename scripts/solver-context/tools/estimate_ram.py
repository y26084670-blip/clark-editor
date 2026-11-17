#!/usr/bin/env python3
"""Estimate resident Float32 matrix storage from component dimensions on one node."""
import argparse
import json
import math
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR
from pathlib import Path

GIB = 1024**3
COEFFICIENT_BYTES = 4


def gib_to_bytes(value, field, rounding):
    if type(value) not in (int, float, Decimal) or not math.isfinite(value) or value < 0:
        raise ValueError(f"{field} must be a non-negative finite number in GiB")
    return int((Decimal(str(value)) * GIB).to_integral_value(rounding=rounding))


def count(value, field):
    if type(value) is not int or value < 0:
        raise ValueError(f"{field} must be a non-negative integer")
    return value


def estimate(plan):
    segments = plan["segments"]
    if not isinstance(segments, list):
        raise ValueError("segments must list the resident matrix segments for one node")
    precision = plan.get("real")
    if precision not in (None, "REAL32", "REAL64"):
        raise ValueError("real must be REAL32 or REAL64")
    limit_kind = plan.get("limit_kind", "recommended")
    if limit_kind not in ("recommended", "hard"):
        raise ValueError("limit_kind must be recommended or hard")
    reserve = gib_to_bytes(plan["reserve_gib"], "reserve_gib", ROUND_CEILING)
    target = plan.get("target_gib")
    if limit_kind == "hard" and target is None:
        raise ValueError("A hard limit requires target_gib")
    budget = None if target is None else gib_to_bytes(target, "target_gib", ROUND_FLOOR)
    matrix_bytes = 0
    seen = set()
    detail = []
    for s in segments:
        rank = count(s["rank"], "rank")
        name = s["matrix"]
        if not isinstance(name, str) or not name.strip():
            raise ValueError("matrix must identify an allocation")
        if (rank, name) in seen:
            raise ValueError(f"Duplicate allocation for rank {rank} and matrix {name}")
        seen.add((rank, name))
        rows = count(s["rows"], "rows")
        cols = count(s["cols"], "cols")
        size = rows * cols * COEFFICIENT_BYTES
        matrix_bytes += size
        detail.append({"rank": rank, "matrix": name, "rows": rows, "cols": cols,
                       "coefficients": rows * cols, "bytes": size})
    total = matrix_bytes + reserve
    within = None if budget is None else total <= budget
    return {"scope": "Explicit resident matrix allocations and one reserve for one node",
            "real": precision, "bytes_per_coefficient": COEFFICIENT_BYTES, "segments": detail,
            "matrix_bytes": matrix_bytes, "matrix_gib": matrix_bytes / GIB,
            "reserve_bytes": reserve, "estimate_bytes": total, "estimate_gib": total / GIB,
            "target_bytes": budget, "limit_kind": limit_kind, "within_target": within,
            "hard_limit_exceeded": limit_kind == "hard" and within is False,
            "measured_peak": None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plan", type=Path, help="UTF-8 JSON with segments, reserve_gib and optional target_gib")
    args = parser.parse_args()
    try:
        plan = json.loads(args.plan.read_text(encoding="utf-8-sig"), parse_float=Decimal)
        report = estimate(plan)
    except (OSError, UnicodeError, ValueError, KeyError, TypeError) as exc:
        parser.exit(2, f"Invalid RAM plan: {exc}\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if report["hard_limit_exceeded"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
