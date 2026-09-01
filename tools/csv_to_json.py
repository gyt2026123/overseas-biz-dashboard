#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
csv_to_json.py —— 把腾讯文档智能表格导出的 CSV 转成网页需要的 data.json

用法（在自己电脑上）：
    1. 在腾讯文档智能表格里，把数据导出为 CSV（字段顺序不限，列名见下）
    2. 把 CSV 放到本目录，命名为 data.csv
    3. 运行：  python3 tools/csv_to_json.py
    4. 生成的 data.json 会被网页自动读取

CSV 需要的列（表头可用中文或英文，二选一）：
    国家/地区  name         —— 国家英文名，必须与底图一致（如 Singapore / 马来西亚填 Malaysia）
    业务状态   status       —— 四选一：已合规上线 / 合规洽谈中 / 规划评估中 / 暂未进入
    负责人    owner         —— 任意文本
    更新时间  updated       —— 任意文本（建议 YYYY-MM-DD）
    备注      note          —— 任意文本

说明：
    - 国家名用于和地图面（assets/countries-50m.json）匹配，匹配不上不会上色但会留在表格里，
      脚本会打印「未匹配」清单方便你核对。
    - 不在这份 CSV 里的国家，网页会按「暂未进入」显示（灰）。
"""
import csv
import json
import os
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEO = os.path.join(BASE, "assets", "countries-50m.json")
CSV = os.path.join(BASE, "data.csv")
OUT = os.path.join(BASE, "data.json")

HEADER_MAP = {
    "国家/地区": "name", "国家": "name", "name": "name",
    "业务状态": "status", "状态": "status", "status": "status",
    "负责人": "owner", "owner": "owner",
    "更新时间": "updated", "更新日期": "updated", "updated": "updated",
    "备注": "note", "note": "note", "remark": "note",
}
VALID_STATUS = {"已合规上线", "合规洽谈中", "规划评估中", "暂未进入"}


def load_geo_names():
    with open(GEO, encoding="utf-8") as f:
        topo = json.load(f)
    return {g["properties"].get("name") for g in topo["objects"]["countries"]["geometries"]}


def main():
    if not os.path.exists(CSV):
        print(f"[错误] 没找到 {CSV}\n请把腾讯文档导出的 CSV 命名为 data.csv 放到工程根目录。")
        sys.exit(1)

    geo_names = load_geo_names()
    rows = []
    matched, unmatched = 0, []

    with open(CSV, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        # 建立 标准字段 -> 原始列名 的映射（兼容 CSV 的 BOM / 首尾空格）
        col_map = {}
        for col in reader.fieldnames or []:
            ckey = col.replace("\ufeff", "").strip()
            key = HEADER_MAP.get(ckey, None)
            if key and key not in col_map:
                col_map[key] = col  # 标准字段 -> 原始列名
        if "name" not in col_map:
            print(f"[错误] CSV 缺少「国家/地区」列。当前表头: {reader.fieldnames}")
            sys.exit(1)

        for r in reader:
            rec = {std: (r.get(raw) or "").strip() for std, raw in col_map.items()}
            name = rec.get("name")
            if not name:
                continue
            status = rec.get("status") or "暂未进入"
            if status not in VALID_STATUS:
                print(f"[警告] 国家「{name}」状态「{status}」不在四态内，按「暂未进入」处理")
                status = "暂未进入"
            if name in geo_names:
                matched += 1
            else:
                unmatched.append(name)
            rows.append({
                "name": name,
                "status": status,
                "owner": rec.get("owner", ""),
                "updated": rec.get("updated", "-"),
                "note": rec.get("note", ""),
            })

    # 未出现在 CSV 里的国家，补为「暂未进入」
    in_csv = {r["name"] for r in rows}
    for n in geo_names:
        if n not in in_csv:
            rows.append({"name": n, "status": "暂未进入", "owner": "", "updated": "-", "note": ""})

    rows.sort(key=lambda x: x["name"])
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)

    print(f"[完成] 已写入 {OUT}（共 {len(rows)} 条，地图匹配 {matched} 个）")
    if unmatched:
        print(f"[提示] 以下 {len(unmatched)} 个国家名未匹配到底图，不会上色（请核对英文名）:")
        print("   " + ", ".join(unmatched))


if __name__ == "__main__":
    main()
