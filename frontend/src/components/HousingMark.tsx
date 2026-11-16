/**
 * Housing mark used in the header.
 *
 * Mirrors `public/favicon.svg` (same 48-unit geometry) so the brand mark is
 * identical in the tab and on the page. Decorative: the adjacent heading
 * already names the product.
 */
export function HousingMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M24 5.5 45.5 25h-8L24 13.6 10.5 25h-8L24 5.5Z" fill="#7de3d4" />
      <rect x="10" y="23.5" width="28" height="19" rx="3.5" fill="#f5fffd" />
      <rect x="21" y="31" width="6" height="11.5" rx="1.5" fill="#0b5b54" />
    </svg>
  );
}
