"""架空データで公開境界と契約の拒否条件を検証する"""
import copy
import json
import unittest
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).parent

# 固定された JSON 契約だけを読み込む
def load(name):
    return json.loads((ROOT / name).read_text(encoding="utf-8"))

class ContractTests(unittest.TestCase):
    # 公開 DTO に未知の私有情報が混入した場合を拒否する
    def test_public_rejects_private_fields(self):
        validator = Draft202012Validator(load("public-talk.schema.json"), format_checker=FormatChecker())
        fixture = load("public-talk.fixture.json")
        validator.validate(fixture)
        for key in ["representativeEmail", "materialUrl", "operatorNote", "review", "token", "content"]:
            candidate = dict(fixture, **{key: "private"})
            self.assertFalse(validator.is_valid(candidate), key)
        candidate = copy.deepcopy(fixture)
        candidate["speakers"][0]["email"] = "private@example.invalid"
        self.assertFalse(validator.is_valid(candidate))

    # 日時と version の境界および必須入力を検証する
    def test_invalid_public_values(self):
        validator = Draft202012Validator(load("public-talk.schema.json"), format_checker=FormatChecker())
        for key, value in [("version",0),("version",1.5),("startsAt","2027-02-30T00:00:00.000Z"),("startsAt","2027-01-01T09:00:00+09:00"),("speakers",[])]:
            candidate = dict(load("public-talk.fixture.json"), **{key:value})
            self.assertFalse(validator.is_valid(candidate), key)

    # 差し戻し原稿と承認済み本文を別 DTO として保持する
    def test_application_and_schema(self):
        schema = load("dto.schema.json")
        Draft202012Validator.check_schema(schema)
        schema["$ref"] = "#/$defs/Application"
        validator = Draft202012Validator(schema, format_checker=FormatChecker())
        fixture = load("application.fixture.json")
        validator.validate(fixture)
        self.assertNotEqual(fixture["content"]["title"], fixture["published"]["title"])
        fixture["operatorNote"] = "private"
        self.assertFalse(validator.is_valid(fixture))

    # 管理経路と例外権限を公開経路から分離する
    def test_routes_and_capabilities(self):
        routes = load("routes.json")
        self.assertEqual(len(routes), len({(r["method"],r["path"]) for r in routes}))
        for route in routes:
            if "/operator/" in route["path"]:
                self.assertIn(route["access"], ["lt.operate","lt.emailChange"])
            if route["access"] == "public":
                self.assertNotIn("Application", route["response"])
        policy = load("policy.json")
        self.assertEqual(policy["capabilities"]["lt.emailChange"], ["admin","executive"])
        self.assertEqual(policy["confirmLinkSeconds"],3600)
        self.assertFalse(policy["sessionSeconds"]["productionEnabled"])
        self.assertEqual(policy["mailAdapter"],"fake")
        self.assertEqual(policy["retentionMode"],"dry-run")
        self.assertEqual(len(policy["notificationKinds"]),7)

if __name__ == "__main__":
    unittest.main()
