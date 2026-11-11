// Pure helpers for the restaurant Media feed. Kept free of JSX so the
// client scripts tests can import them directly.

// Dish anchor state for the TikTok-shop product bar.
// available=true  → live dish, tappable (jumps to the menu item).
// available=false → snapshot only, plain text, not tappable.
export const dishLinkState = (dish) => (dish?.available === true ? 'tappable' : 'snapshot');

// Optimistic like toggle. The server is the source of truth; the caller
// applies this immediately, then reconciles with the response's
// { liked, like_count } by overwriting the row.
export const applyLikeToggle = (media) => {
  const liked = !media.liked_by_me;
  return {
    ...media,
    liked_by_me: liked,
    // Adjust the count by the delta implied by the toggle, clamped at 0.
    like_count: Math.max(0, Number(media.like_count || 0) + (liked ? 1 : -1)),
  };
};

// Flag reasons accepted by the server for media flags.
export const MEDIA_FLAG_REASONS = ['unrelated', 'spam', 'broken', 'inappropriate'];

// Older deployments may not expose the private uploads endpoint yet. A 404
// is the only response that can safely mean "feature unavailable"; auth,
// database, and storage failures must remain visible to the caller.
export const isMissingMediaMineEndpoint = (err) => err?.response?.status === 404;
