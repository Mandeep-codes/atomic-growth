// ── The country list, and nothing else ──
//
// Split out of demographic.ts so the FRONTEND can import it. The admin geo-rule
// editor and the clipper's weekly-demographics form both need this list for
// their country dropdowns, and the list must be identical to the one the API
// validates against — a country the UI offers but the schema rejects is a form
// that cannot be submitted.
//
// KEEP THIS FILE FREE OF IMPORTS.
//
// Vite bundles it into the frontend from outside the frontend package, and
// DigitalOcean builds the frontend with `npm install` run only inside
// `frontend/`. So there is no `backend/node_modules` and no root
// `node_modules` at build time, and any bare import here ("zod", anything)
// fails to resolve and takes the whole deploy down. That is exactly what
// happened on 2026-08-01: the frontend imported `countrySchema` from
// demographic.ts, which imports zod, and the build died with
// "Rollup failed to resolve import 'zod'".
//
// Every OTHER cross-package import in the frontend is `import type`, which the
// compiler erases before the bundler ever sees it — which is why nothing had
// broken this way before.
export const COUNTRIES = [
  "Afghanistan",
  "Albania",
  "Algeria",
  "Argentina",
  "Armenia",
  "Australia",
  "Austria",
  "Azerbaijan",
  "Bangladesh",
  "Belarus",
  "Belgium",
  "Bolivia",
  "Bosnia and Herzegovina",
  "Brazil",
  "Bulgaria",
  "Cambodia",
  "Cameroon",
  "Canada",
  "Chile",
  "China",
  "Colombia",
  "Costa Rica",
  "Croatia",
  "Cuba",
  "Czech Republic",
  "Denmark",
  "Dominican Republic",
  "Ecuador",
  "Egypt",
  "El Salvador",
  "Estonia",
  "Ethiopia",
  "Finland",
  "France",
  "Georgia",
  "Germany",
  "Ghana",
  "Greece",
  "Guatemala",
  "Honduras",
  "Hong Kong",
  "Hungary",
  "Iceland",
  "India",
  "Indonesia",
  "Iran",
  "Iraq",
  "Ireland",
  "Israel",
  "Italy",
  "Jamaica",
  "Japan",
  "Jordan",
  "Kazakhstan",
  "Kenya",
  "Kuwait",
  "Latvia",
  "Lebanon",
  "Libya",
  "Lithuania",
  "Luxembourg",
  "Malaysia",
  "Mexico",
  "Moldova",
  "Mongolia",
  "Morocco",
  "Nepal",
  "Netherlands",
  "New Zealand",
  "Nigeria",
  "North Korea",
  "North Macedonia",
  "Norway",
  "Pakistan",
  "Panama",
  "Paraguay",
  "Peru",
  "Philippines",
  "Poland",
  "Portugal",
  "Qatar",
  "Romania",
  "Russia",
  "Saudi Arabia",
  "Senegal",
  "Serbia",
  "Singapore",
  "Slovakia",
  "Slovenia",
  "South Africa",
  "South Korea",
  "Spain",
  "Sri Lanka",
  "Sweden",
  "Switzerland",
  "Syria",
  "Taiwan",
  "Tanzania",
  "Thailand",
  "Tunisia",
  "Turkey",
  "Uganda",
  "Ukraine",
  "United Arab Emirates",
  "United Kingdom",
  "United States",
  "Uruguay",
  "Venezuela",
  "Vietnam",
  "Yemen",
  "Zambia",
  "Zimbabwe",
  "Other", // Other countries not listed above
] as const;

export type Country = (typeof COUNTRIES)[number];
