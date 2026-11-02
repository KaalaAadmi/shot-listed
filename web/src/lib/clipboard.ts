"use client";

/**
 * Copies text exactly, line breaks included. Uses the Clipboard API, falling back to a
 * hidden textarea for older iOS versions. Must be called from a tap or click.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}
