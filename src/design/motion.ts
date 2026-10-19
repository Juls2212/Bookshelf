// Motion tokens: calm, short, never exaggerated (mockup p12 "Movimiento").
export const motion = {
  /** Opening the library: each cover rises a few px and fades in. */
  shelfArrival: {
    durationMs: 320,
    staggerMs: 60,
    offsetY: 8,
    /** Only the first visible tiles animate; the rest just appear. */
    maxAnimatedTiles: 12,
  },
  /** Saving a new book: its cover drops and settles onto the shelf. */
  newBookDrop: {
    durationMs: 400,
    offsetY: -28,
  },
  /** A new recommendation in the Librero: the card rises a few px and fades in. */
  recommendationArrival: {
    durationMs: 400,
    offsetY: 16,
  },
  /** Updating the page: the bookmark ribbon slides to its new place on a soft curve. */
  bookmarkSlide: {
    durationMs: 280,
  },
} as const;

/** Total time of the shelf arrival sequence (used to stop animating late mounts). */
export const shelfArrivalTotalMs =
  motion.shelfArrival.durationMs +
  motion.shelfArrival.staggerMs * (motion.shelfArrival.maxAnimatedTiles - 1);
