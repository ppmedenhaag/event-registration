import type { Route } from "./+types/terms";
import { LegalPage } from "~/components/LegalPage";
import { LEGAL_DOCS, parseLegalLang } from "~/lib/legal-content";

// Public on every Worker (public, admin, check-in): no login, no env, no database. Google's OAuth consent screen links here.
export function meta({ loaderData }: Route.MetaArgs) {
  const lang = loaderData?.lang ?? "id";
  return [
    { title: `${LEGAL_DOCS[lang].terms.title} – PPME Den Haag` },
    { name: "description", content: LEGAL_DOCS[lang].terms.intro },
  ];
}

export function loader({ url }: Route.LoaderArgs) {
  return { lang: parseLegalLang(url.searchParams.get("lang")) };
}

export default function Terms({ loaderData }: Route.ComponentProps) {
  return <LegalPage doc="terms" lang={loaderData.lang} />;
}
