/**
 * True when a key event should activate the focused row itself.
 *
 * Key events from links or buttons inside the row bubble to the row handler.
 * Those controls keep their own activation behaviour, so the row must ignore
 * descendant events.
 */
export function isRowActivation(event: {
  key: string;
  target: unknown;
  currentTarget: unknown;
}): boolean {
  return (
    (event.key === "Enter" || event.key === " ") &&
    event.target === event.currentTarget
  );
}
