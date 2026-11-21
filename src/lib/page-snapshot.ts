export function snapshotPage(source: HTMLElement, incoming = false) {
  const clone = source.cloneNode(true) as HTMLElement;
  const sourceNodes = [source, ...source.querySelectorAll<HTMLElement>("*")];
  const cloneNodes = [clone, ...clone.querySelectorAll<HTMLElement>("*")];
  sourceNodes.forEach((el, i) => {
    const animations = el.getAnimations();
    if (!animations.length) return;
    const style = getComputedStyle(el),
      copy = cloneNodes[i];
    for (const property of ["transform", "opacity", "clip-path"])
      copy.style.setProperty(property, style.getPropertyValue(property));
    // A newly mounted destination has not played its entrances yet. Its portal
    // must show the finished content; ongoing ambient motion keeps its frame.
    if (incoming)
      for (const animation of animations) {
        const effect = animation.effect;
        if (
          !(effect instanceof KeyframeEffect) ||
          effect.getTiming().iterations === Infinity
        )
          continue;
        const last = effect.getKeyframes().at(-1);
        if (!last) continue;
        for (const [css, key] of [
          ["transform", "transform"],
          ["opacity", "opacity"],
          ["clip-path", "clipPath"],
        ]) {
          const value = last[key];
          if (value !== undefined) copy.style.setProperty(css, String(value));
        }
      }
  });
  clone.style.visibility = "visible";
  clone.inert = true;
  clone.removeAttribute("id");
  clone.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
  clone.querySelectorAll("input,textarea,select").forEach((el, i) => {
    const original = source.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >("input,textarea,select")[i];
    (el as HTMLInputElement).value = original.value;
    if (el instanceof HTMLInputElement && original instanceof HTMLInputElement)
      el.checked = original.checked;
  });
  const canvases = source.querySelectorAll("canvas");
  clone.querySelectorAll("canvas").forEach((canvas, i) => {
    try {
      canvas.getContext("2d")?.drawImage(canvases[i], 0, 0);
    } catch {}
  });
  clone
    .querySelectorAll(".scroll-rail,.menu,.wallet-popover,.replay-seal")
    .forEach((el) => el.remove());
  return clone;
}
