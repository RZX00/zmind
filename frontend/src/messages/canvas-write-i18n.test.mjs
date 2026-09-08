import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const loadLocale = (name) => {
  const raw = readFileSync(join(here, name), "utf8");
  const parsed = JSON.parse(raw);
  assert.equal(typeof parsed, "object");
  return parsed;
};

test("en and zh-CN include billing.modal and workspace.switchGuard keys", () => {
  const en = loadLocale("en.json");
  const zh = loadLocale("zh-CN.json");

  for (const locale of [en, zh]) {
    assert.equal(typeof locale.billing.modal.title, "string");
    assert.match(locale.billing.modal.title, /\S/);
    assert.doesNotMatch(locale.billing.modal.title, /\?{2,}/);
    for (const key of ["title", "description", "confirm", "cancel"]) {
      const value = locale.workspace.switchGuard[key];
      assert.equal(typeof value, "string");
      assert.match(value, /\S/);
      assert.doesNotMatch(value, /\?{2,}/);
    }
  }

  assert.equal(en.billing.modal.title, "Add credits");
  assert.equal(zh.billing.modal.title, "充值积分");
});
