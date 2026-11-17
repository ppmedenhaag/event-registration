import { Link } from "react-router";

import { Backdrop, Eyebrow, Logo } from "~/components/ui";
import { LEGAL_CONTACT, LEGAL_DOCS, LEGAL_UI, LEGAL_UPDATED, type LegalDocKey, type LegalLang } from "~/lib/legal-content";

const path = (doc: LegalDocKey, lang: LegalLang) => `/${doc}${lang === "en" ? "?lang=en" : ""}`;

/** Public privacy policy / terms page: no login, no data, same on every Worker. */
export function LegalPage({ doc, lang }: { doc: LegalDocKey; lang: LegalLang }) {
  const content = LEGAL_DOCS[lang][doc];
  const ui = LEGAL_UI[lang];
  const other: LegalDocKey = doc === "privacy" ? "terms" : "privacy";

  return (
    <Backdrop>
      <main lang={lang} className="mx-auto w-full max-w-[44rem] px-4 py-10 sm:py-16">
        <div className="border border-slate-200/80 bg-white/85 shadow-sm shadow-slate-900/5 backdrop-blur-md">
          <div className="h-1 bg-brand" aria-hidden="true" />
          <header className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-6 pt-7 pb-6 sm:px-8">
            <div className="min-w-0">
              <Eyebrow className="flex items-center gap-2 text-brand">
                <span className="inline-block size-1.5 rounded-full bg-brand" aria-hidden="true" />
                PPME Den Haag
              </Eyebrow>
              <h1 className="text-gradient-brand mt-2.5 text-[1.75rem] leading-tight font-bold tracking-tight">{content.title}</h1>
              <p className="mt-2 text-sm text-slate-500">
                {ui.updated}: {LEGAL_UPDATED}
              </p>
            </div>
            <Logo className="h-10 w-auto sm:h-12" />
          </header>

          <nav className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 bg-slate-50/70 px-6 py-3 text-sm sm:px-8" aria-label="Legal">
            <div className="flex items-center gap-4">
              <Link to={path("privacy", lang)} className={doc === "privacy" ? "font-semibold text-slate-900" : "text-brand hover:text-brand-dark"}>
                {ui.privacy}
              </Link>
              <Link to={path("terms", lang)} className={doc === "terms" ? "font-semibold text-slate-900" : "text-brand hover:text-brand-dark"}>
                {ui.terms}
              </Link>
            </div>
            <div className="flex items-center gap-2 text-slate-500">
              <span>{ui.language}:</span>
              <Link to={path(doc, "id")} className={lang === "id" ? "font-semibold text-slate-900" : "text-brand hover:text-brand-dark"} hrefLang="id">
                Indonesia
              </Link>
              <span aria-hidden="true">·</span>
              <Link to={path(doc, "en")} className={lang === "en" ? "font-semibold text-slate-900" : "text-brand hover:text-brand-dark"} hrefLang="en">
                English
              </Link>
            </div>
          </nav>

          <article className="space-y-6 px-6 py-7 text-[15px] leading-relaxed text-slate-700 sm:px-8">
            <p>{content.intro}</p>
            {content.sections.map((s, i) => (
              <section key={i} className="space-y-3">
                {s.heading ? <h2 className="text-lg font-semibold text-slate-900">{s.heading}</h2> : null}
                {s.paragraphs?.map((p, j) => (
                  <p key={j}>{p}</p>
                ))}
                {s.bullets ? (
                  <ul className="list-disc space-y-1.5 pl-5 marker:text-slate-400">
                    {s.bullets.map((b, j) => (
                      <li key={j}>{b}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
            <p className="border-t border-slate-200/80 pt-5 text-sm text-slate-500">
              {ui.contact}{" "}
              <a href={`mailto:${LEGAL_CONTACT}`} className="font-medium text-brand hover:text-brand-dark">
                {LEGAL_CONTACT}
              </a>
              . {ui.draftNote}{" "}
              <Link to={path(other, lang)} className="font-medium text-brand hover:text-brand-dark">
                {LEGAL_UI[lang][other]}
              </Link>
            </p>
          </article>
        </div>
      </main>
    </Backdrop>
  );
}
