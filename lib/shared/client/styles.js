/**
 * @description Load the mascot stylesheet once per document.
 * @returns {void}
 */
export function injectCss() {
  if (document.getElementById("dsh-kujira-appearance")) return;
  const link = document.createElement("link");
  link.id = "dsh-kujira-appearance";
  link.rel = "stylesheet";
  link.href = "/dsh-kujira/appearance.css";
  document.head.appendChild(link);
}
