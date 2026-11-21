"""把比赛归档转成后端六份 JSON；单日截面永不充当完整档期库存。"""
import argparse
import json
from pathlib import Path


def load(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def aliases(name):
    text = str(name or "").replace(" ", "").replace("　", "").replace("路", "").replace("（", "(").replace("）", ")")
    result = {text}
    for separator in ("/", "、", ","):
        if separator in text:
            result.update(text.split(separator))
    return result - {""}


def build(source, output):
    index = load(source / "processed/media_index.json")
    seed = load(source / "seed/industries.json")["industries"]
    geo = load(source / "raw/geo/candidates.json")
    geo_anchors = {a["id"]: a for industry in geo["industries"] for a in industry["anchors"]}
    traffic_path = source / "processed/traffic.json"
    traffic = load(traffic_path) if traffic_path.exists() else {"byMediaKey": {}}
    modules = {kind: {"mediaByKey": {}, "windows": []} for kind in ("bus", "metro")}
    for key, row in index.items():
        fields = ["kind", "resourceId", "lineName", "levelName", "total"]
        fields.append("mediaForm" if row["kind"] == "bus" else "exit")
        modules[row["kind"]]["mediaByKey"][key] = {f: row[f] for f in fields if row.get(f) is not None}
    for path in sorted((source / "raw/hongdou/windows").glob("*.json")):
        raw = load(path)
        meta = raw["_meta"]
        kind = meta["kind"]
        if meta["queryStart"] == meta["queryEnd"]:
            raise ValueError(f"{path.name} 是单日截面，不能作为演示整月窗口")
        captured = meta["capturedAt"]
        if not (captured.endswith("Z") or "+" in captured[10:] or "-" in captured[10:]):
            raise ValueError(f"{path.name} 查询时间缺少时区")
        window = {"startDate": meta["queryStart"], "endDate": meta["queryEnd"],
                  "queriedAt": captured, "billingMonths": meta["billingMonths"], "inventoryByKey": {}}
        for row in raw["list"]:
            suffix = row.get("mediaName") if kind == "bus" else row.get("exitName")
            key = f"{kind}|{row['resourceId']}|{suffix or ''}"
            if key not in modules[kind]["mediaByKey"]:
                raise ValueError(f"完整档期出现目录未登记媒体 {key}，请先更新目录")
            item = {"freeCount": row.get("freeCount")}
            for src, dst in [("contractCount", "contractCount"), ("reservationCount", "reservedCount")]:
                if row.get(src) is not None:
                    item[dst] = row[src]
            window["inventoryByKey"][key] = item
        modules[kind]["windows"].append(window)
    coverage, industries, unmatched = {}, [], []
    for industry in seed:
        industries.append({k: industry[k] for k in ("id", "name", "client", "campaign")})
        industries[-1]["anchors"] = []
        for anchor in industry["anchors"]:
            aid = anchor["id"]
            industries[-1]["anchors"].append({"id": aid, "rationale": anchor["rationale"]})
            entry = {k: anchor[k] for k in ("areaName", "station", "role")}
            entry["coord"] = {k: anchor["coord"][k] for k in ("lng", "lat", "exit")}
            entry["coord"]["source"] = "可视化平台 sopLabelPoints 代表出口坐标；data/raw/geo/station_points.json"
            candidates = {}
            for line in geo_anchors[aid]["lines"]:
                if line.get("mediaType") != "bus":
                    continue
                matches = [(k, row) for k, row in modules["bus"]["mediaByKey"].items() if aliases(line["lineName"]) & aliases(row["lineName"])]
                if len({r["resourceId"] for _, r in matches}) > 1:
                    unmatched.append({"anchorId": aid, "lineName": line["lineName"], "reason": "ambiguous"})
                    continue
                if not matches:
                    unmatched.append({"anchorId": aid, "lineName": line["lineName"], "reason": "not_in_inventory"})
                for key, _ in matches:
                    item = {"mediaKey": key, "relation": "商圈锚点 1200 米覆盖公交线路", "source": f"可视化平台 matchCoverLines；锚点 {aid}；data/raw/geo/candidates.json"}
                    distance = line.get("minDistance")
                    if isinstance(distance, (int, float)) and distance >= 0:
                        item["distanceM"] = distance
                    candidates[key] = item
            for key, row in modules["metro"]["mediaByKey"].items():
                if row["lineName"] == anchor["station"]:
                    candidates[key] = {"mediaKey": key, "relation": "锚点同名地铁站的具体出口（非逐出口距离）", "source": f"红豆站名/出口精确关联；锚点 {aid}"}
            entry["candidates"] = list(candidates.values())
            coverage[aid] = entry
    prices = {}
    ranges = {"bus": {"S": (50000, 70000, 10), "A++": (40000, 60000, 11), "A+": (30000, 50000, 12)},
              "metro": {"A++": (250000, 350000, 8), "A+": (150000, 250000, 9)}}
    for key, row in index.items():
        rule = ranges[row["kind"]].get(row["levelName"])
        if not rule:
            continue
        low, high, line = rule
        assumptions = ["区间化刊例中值仅用于预算估算，不代表真实成交价；未计折扣及税费"]
        if row["kind"] == "bus":
            if row.get("mediaForm") not in ("大三侧", "车身三侧"):
                continue
            production = 7500
            assumptions.append("公交一次性制作费按 5000–10000 元区间中值 7500 元/辆估算")
        else:
            area = 12 if row["levelName"] == "A++" else 8
            production = 100 * area
            assumptions.append(f"地铁实际计费面积尚未核对，按 {area} ㎡ × 100 元/㎡估算制作费；媒体形式待现场确认")
        prices[key] = {"monthlyLowYuan": low, "monthlyHighYuan": high, "productionYuan": production,
                       "source": f"资料包 07-媒体刊例价.xlsx 第 {line} 行；应用架构与接口首版报价口径", "assumptions": assumptions}
    traffic = {"byMediaKey": {k: v for k, v in traffic["byMediaKey"].items() if k in modules["bus"]["mediaByKey"]}}
    output.mkdir(parents=True, exist_ok=True)
    files = {**modules, "pricing": {"pricesByMediaKey": prices}, "briefs": {"industries": industries},
             "coverage": {"anchorsById": coverage}, "traffic": traffic}
    for name, content in files.items():
        (output / f"{name}.json").write_text(json.dumps(content, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report = {"media": {k: len(v["mediaByKey"]) for k, v in modules.items()},
              "windows": {k: len(v["windows"]) for k, v in modules.items()}, "anchors": len(coverage),
              "prices": len(prices), "traffic": len(traffic["byMediaKey"]), "unmatched": unmatched}
    (output / "data-notes.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "unmatched"}, ensure_ascii=False))
    print(f"未匹配/歧义记录 {len(unmatched)} 条，见 data-notes.json；无库存与刊例的媒体不会报价")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[3] / "data")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[2] / "data")
    args = parser.parse_args()
    build(args.source, args.output)
