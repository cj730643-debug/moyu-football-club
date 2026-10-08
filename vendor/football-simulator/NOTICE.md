Vendored from tbleckert/football-simulator, commit 39529b19c40868d66aa47db084ebc9ea29c86e70 (MIT).
Original copyright and license are retained in LICENSE. Relative TypeScript imports carry .ts extensions for Deno interoperability. No NFL data or code from the other reference repositories is included.

MFC.2 corrects shot/goal-plane crossing interpolation for fixed simulation ticks (the production adapter uses 1-second ticks); goal outcome is still resolved by the engine.

MFC.3 resolves simultaneous loose-ball arrivals using anticipation, first touch, acceleration and the seeded RNG. Array order previously awarded every equal-distance recovery to the home roster.
