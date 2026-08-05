import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const FILES = {
  html: "public-dashboard.html",
  entry: "src/public-main.tsx",
  app: "src/components/PublicDashboardApp.tsx",
  vite: "vite.config.ts",
};

test("standalone public dashboard has an independent Vite entry", async () => {
  const [html, entry, vite] = await Promise.all([
    readFile(FILES.html, "utf8"),
    readFile(FILES.entry, "utf8"),
    readFile(FILES.vite, "utf8"),
  ]);

  assert.match(html, /id="public-root"/);
  assert.match(html, /src="\/src\/public-main\.tsx"/);
  assert.match(entry, /PublicDashboardApp/);
  assert.match(vite, /public-dashboard\.html/);
  assert.match(vite, /publicDashboard:/);
});

test("public shell is read-only and does not import the operational API", async () => {
  const [entry, app] = await Promise.all([
    readFile(FILES.entry, "utf8"),
    readFile(FILES.app, "utf8"),
  ]);
  const source = `${entry}\n${app}`;

  assert.doesNotMatch(source, /from\s+["'][^"']*(?:api|server|domain|decision|production)[^"']*["']/i);
  assert.doesNotMatch(source, /\/api\//i);
  assert.doesNotMatch(source, /\b(?:POST|PUT|PATCH|DELETE)\b/);
  assert.doesNotMatch(source, /<form\b|onSubmit=|onClick=/i);
  assert.match(source, /read-only|閲覧専用/i);
  assert.match(source, /自動投票なし/);
  assert.match(source, /利益を保証しません/);
});

test("public shell includes research, methodology, glossary and safety landmarks", async () => {
  const app = await readFile(FILES.app, "utf8");
  for (const landmark of ["research", "methodology", "glossary", "safety"]) {
    assert.match(app, new RegExp(`id=\\"${landmark}\\"`));
  }
  assert.match(app, /ResearchCommandCenter/);
  assert.match(app, /GLOSSARY_TERMS/);
  assert.match(app, /AD PLACEMENT RESERVED/);
});
