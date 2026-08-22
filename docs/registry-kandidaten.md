# Registry-Kandidaten (Eintrag nach M2)
- DAV-Client ohne Obsidian: injizierter Transport + namespace-toleranter Multistatus-Parser (`fast-xml-parser`, `removeNSPrefix`) — `src/core/dav/`
- Fake-Transport für HTTP-Clients in vitest (Routen + Capture) — `tests/helpers/fake-transport.ts`
- Wegwerf-Radicale per `uvx` als Integrations-Server — `scripts/dav-server.ts`
- ical.js-Mutationen, die fremde Properties erhalten (Component-basiert statt Neubau) — `src/core/ical/mutate.ts`, `src/core/vcard/mutate.ts`
- Notiz-Plan mit Feldklassen (verwaltet/einmalig/frei) + verwalteter Body-Block — `src/core/mirror/plan.ts`, `body.ts`, Schema in Spec §3
- Wiederholungs-Fensterprüfung über ical.js RecurExpansion — `src/core/ical/recur.ts`, `eventOccursWithin` mit EXDATE + Override-Support
