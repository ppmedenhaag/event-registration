import { createContext } from "react-router";

/** Who is looking at the read-only panitia dashboards (set by the /panitia layout middleware). */
export const panitiaContext = createContext<{ kind: "viewer" | "admin"; email: string; name: string | null }>();
