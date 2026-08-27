/** Room ids with a hand in progress right now.
 *
 *  Lives in its own module because both the game engine (which writes it) and
 *  the REST money routes (which read it before moving chips) need it, and
 *  importing the engine from rooms.ts would close an import cycle. */
export const activeHands = new Set<string>();
