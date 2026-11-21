"""通过比赛 OAuth2 账号查询完整档期；凭证仅取环境变量，不落盘。"""
import argparse
import base64
import json
import os
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

BASE = "https://flairmedia.com.cn:881"


def request(path, headers, body=None):
    req = urllib.request.Request(BASE + path, headers=headers, data=body)
    with urllib.request.urlopen(req, timeout=30) as response:
        payload = json.load(response)
    if payload.get("code") != 0:
        raise RuntimeError(f"红豆请求失败，code={payload.get('code')}；请检查比赛账号授权")
    return payload["data"]


def fetch_window(start, end, billing_months, output):
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    if first.year != 2027 or last.year != 2027 or first > last or billing_months <= 0:
        raise ValueError("须为 2027 年内有效档期与正数计费月数")
    headers = {"tenant-id": os.getenv("HONGDOU_TENANT_ID", "1")}
    token = os.getenv("HONGDOU_TOKEN")
    if not token:
        names = ("HONGDOU_USERNAME", "HONGDOU_PASSWORD", "HONGDOU_CLIENT_ID", "HONGDOU_CLIENT_SECRET")
        values = [os.getenv(name) for name in names]
        if not all(values):
            raise ValueError("设置 HONGDOU_TOKEN，或 " + "、".join(names))
        username, password, client_id, client_secret = values
        auth_headers = {**headers, "Content-Type": "application/x-www-form-urlencoded",
                        "Authorization": "Basic " + base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()}
        form = urllib.parse.urlencode({"grant_type": "password", "username": username, "password": password}).encode()
        token = request("/admin-api/system/oauth2/token", auth_headers, form)["access_token"]
    headers["Authorization"] = "Bearer " + token
    output.mkdir(parents=True, exist_ok=True)
    for kind, expected in (("bus", 431), ("metro", 861)):
        query = urllib.parse.urlencode({"pageNo": 1, "pageSize": 1000, "startDate": start, "endDate": end})
        rows = request(f"/admin-api/orders/media-inventory/{kind}/page?{query}", headers).get("list", [])
        keys = [(r["resourceId"], r.get("mediaName") if kind == "bus" else r.get("exitName")) for r in rows]
        if len(rows) != expected or len(set(keys)) != len(rows):
            raise ValueError(f"{kind} 返回 {len(rows)} 行，预期 {expected} 条唯一媒体记录，需核对目录")
        bundle = {"_meta": {"kind": kind, "queryStart": start, "queryEnd": end,
                              "capturedAt": datetime.now(timezone.utc).isoformat(), "billingMonths": billing_months,
                              "source": f"红豆 /admin-api/orders/media-inventory/{kind}/page"}, "list": rows}
        target = output / f"{kind}-{start}_{end}.json"
        target.write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"{kind}: {start} 至 {end}，{len(rows)} 行，已保存 {target.name}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--billing-months", required=True, type=float)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[3] / "data/raw/hongdou/windows")
    args = parser.parse_args()
    fetch_window(args.start, args.end, args.billing_months, args.output)
