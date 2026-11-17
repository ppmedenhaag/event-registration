import { describe, expect, it } from "vitest";

import { LEGAL_DOCS, parseLegalLang, type LegalDocKey } from "../app/lib/legal-content";

describe("public legal pages", () => {
  for (const key of ["privacy", "terms"] as LegalDocKey[]) {
    it(`${key}: Indonesian and English have the same structure`, () => {
      const id = LEGAL_DOCS.id[key];
      const en = LEGAL_DOCS.en[key];
      expect(en.sections.length).toBe(id.sections.length);
      id.sections.forEach((s, i) => {
        expect(!!en.sections[i].heading, `${key} section ${i} heading`).toBe(!!s.heading);
        expect(en.sections[i].paragraphs?.length ?? 0, `${key} section ${i} paragraphs`).toBe(s.paragraphs?.length ?? 0);
        expect(en.sections[i].bullets?.length ?? 0, `${key} section ${i} bullets`).toBe(s.bullets?.length ?? 0);
      });
    });
  }

  it("the privacy policy covers Google sign-in with the minimal scopes and Limited Use", () => {
    for (const lang of ["id", "en"] as const) {
      const text = JSON.stringify(LEGAL_DOCS[lang].privacy);
      expect(text).toContain("openid");
      expect(text).toContain("Limited Use");
      expect(text).toContain("event@ppmedenhaag.nl");
    }
  });

  it("falls back to Indonesian for anything but ?lang=en", () => {
    expect(parseLegalLang("en")).toBe("en");
    expect(parseLegalLang("nl")).toBe("id");
    expect(parseLegalLang(null)).toBe("id");
  });
});
