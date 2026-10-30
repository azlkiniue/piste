# Station data comes from Launch Library 2, built inside enrich-ll2

The people dataset uses Wikidata as its base, but Station data (Stations, Expeditions and Stays) comes from LL2's space station, expedition and docking-event endpoints, and is built during the `enrich-ll2` step rather than in a step of its own. LL2 is the only source that covers all twelve Stations and, through docking events, the Visitors; Wikidata has Expedition crews for the ISS only, and Supercluster knows only today's crews. It runs inside `enrich-ll2` because matching a docking's crew to a Person needs the LL2-to-Person matching that exists only while that step runs, and because it then shares that step's ~15-calls-an-hour budget, page cache and offline replay. Wikidata's ISS Expedition crews are kept as a cross-check that only warns.

## Considered Options

- **A separate `enrich-stations` step** after `enrich-supercluster`: rejected, because it would need each Person's LL2 id stored in the dataset, and it would pace its own calls separately against the same rate limit.
- **Wikidata for ISS Expeditions, LL2 for the rest**: rejected, because Wikidata's ISS items lack dates for Expeditions 53–56, 70 and 72–75, and carry crew roles on only a few dozen entries.
