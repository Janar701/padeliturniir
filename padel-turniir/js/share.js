// Jagamislingid: kuna turniir elab pilves (Firestore), piisab lingis ainult ID-st.
// #/t/<id>      — vaid vaatamiseks, uueneb automaatselt
// #/t/<id>/edit — teised saavad ka skoore sisestada, uueneb automaatselt

export function buildViewUrl(id) {
  const url = new URL(window.location.href);
  url.hash = `/t/${id}`;
  return url.toString();
}

export function buildEditUrl(id) {
  const url = new URL(window.location.href);
  url.hash = `/t/${id}/edit`;
  return url.toString();
}

export function parseShareHash() {
  const match = window.location.hash.match(/^#\/t\/([^/]+)(\/edit)?$/);
  if (!match) return null;
  return { id: match[1], isEdit: !!match[2] };
}
