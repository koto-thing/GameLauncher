"""JSON Schema から LT DTO の TypeScript 宣言を生成する"""
import json
from pathlib import Path
ROOT = Path(__file__).parent

def render(s):
    if "$ref" in s: return s["$ref"].split("/")[-1]
    if "const" in s: return json.dumps(s["const"])
    if "enum" in s: return " | ".join(json.dumps(x) for x in s["enum"])
    if "anyOf" in s: return " | ".join(render(x) for x in s["anyOf"])
    kind=s.get("type")
    if kind=="object":
        return "{ " + "; ".join(k + ("" if k in s.get("required",[]) else "?") + ": " + render(v) for k,v in s.get("properties",{}).items()) + " }"
    if kind=="array": return "Array<" + render(s["items"]) + ">"
    return {"integer":"number","number":"number","string":"string","boolean":"boolean","null":"null"}[kind]

def generate():
    defs=json.loads((ROOT/"dto.schema.json").read_text(encoding="utf-8"))["$defs"]
    header="// 自動生成: generate_types.py を実行する。実行時検証は JSON Schema を使用する\n"
    aliases='export type Instant = string;\nexport type Id = string;\nexport type Version = number;\nexport type Role = "admin" | "executive" | "assistant" | null;\nexport type Capability = "lt.operate" | "lt.emailChange";\n'
    return header+aliases+"".join("export type "+k+" = "+render(v)+";\n" for k,v in defs.items())

if __name__=="__main__":
    (ROOT/"v1.ts").write_text(generate(),encoding="utf-8")
