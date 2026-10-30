# Stays live on Flights in the people dataset

Each Stay is stored on the Flight that made it, in the people dataset (`astronauts.json`). The station dataset holds only Stations and Expeditions, so the station pages read most of their data from the people file. A Stay sits inside a Flight by definition; storing it there means the detail panel on every page can show a Flight's Stations without loading a second file, and the existing `flights` correction in `enrich-manual` already corrects Stays.

## Consequences

- The people file grows by about 70 KB, on top of its current 553 KB.
- An Expedition's crew isn't stored on the Expedition: it comes from scanning the Stays that list it. A crew correction in `enrich-manual` rewrites those Stays.
- Correcting a single Stay means restating that Person's whole `flights` list, and any `flights` correction for someone with Stays must include them, or they are lost.
