/**
 * Cinematic grade on top of the canvas: vignette plus fine grain. Doing this in
 * CSS rather than a postprocessing pass costs no GPU time and no extra library.
 */
export function Grade() {
  return (
    <>
      <div aria-hidden className="grade-vignette pointer-events-none absolute inset-0 z-20" />
      <div aria-hidden className="grade-grain pointer-events-none absolute inset-0 z-20" />
    </>
  )
}
