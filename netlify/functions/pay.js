const crypto = require("crypto");

const PRICE = 6750;
const BASE =
  process.env.FEDAPAY_ENV === "live"
    ? "https://api.fedapay.com/v1"
    : "https://sandbox-api.fedapay.com/v1";

const H = () => ({
  Authorization: `Bearer ${process.env.FEDAPAY_SECRET_KEY}`,
  "Content-Type": "application/json",
});

const out = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

async function getTx(id) {
  const r = await fetch(`${BASE}/transactions/${encodeURIComponent(id)}`, {
    headers: H(),
  });
  if (!r.ok) return null;
  const d = await r.json();
  return d["v1/transaction"] || d.transaction || null;
}

exports.handler = async (event) => {
  try {
    // 1) CRÉER LE PAIEMENT (appelé quand le client clique sur "Régler")
    if (event.httpMethod === "POST") {
      const { name, email, phone } = JSON.parse(event.body || "{}");
      if (!name || !email || !phone) return out(400, { error: "Champs manquants" });

      const parts = String(name).trim().split(/\s+/);
      const ref = crypto.randomBytes(12).toString("hex");

      const c = await fetch(`${BASE}/transactions`, {
        method: "POST",
        headers: H(),
        body: JSON.stringify({
          description: "Livre : Comprendre la sécurité informatique",
          amount: PRICE,
          currency: { iso: "XOF" },
          callback_url: `${process.env.SITE_URL}/?paid=1`,
          merchant_reference: ref,
          custom_metadata: { phone: String(phone) },
          customer: {
            firstname: parts[0],
            lastname: parts.slice(1).join(" ") || parts[0],
            email,
          },
        }),
      });
      if (!c.ok) {
        console.error("create", await c.text());
        return out(502, { error: "Création du paiement impossible" });
      }
      const cj = await c.json();
      const tx = cj["v1/transaction"] || cj.transaction;

      const t = await fetch(`${BASE}/transactions/${tx.id}/token`, {
        method: "POST",
        headers: H(),
      });
      if (!t.ok) {
        console.error("token", await t.text());
        return out(502, { error: "Page de paiement indisponible" });
      }
      const tj = await t.json();
      return out(200, { url: tj.url, id: tx.id, ref });
    }

    // 2) VÉRIFIER LE PAIEMENT (appelé au retour du client sur le site)
    const { id, ref } = event.queryStringParameters || {};
    if (!id || !ref) return out(200, { paid: false });

    const tx = await getTx(id);
    const ok =
      tx &&
      tx.status === "approved" &&
      tx.merchant_reference === ref &&
      Number(tx.amount) === PRICE;

    if (!ok) return out(200, { paid: false, status: tx ? tx.status : null });

    return out(200, {
      paid: true,
      pdf: process.env.BOOK_PDF_URL,
      epub: process.env.BOOK_EPUB_URL,
      whatsapp: process.env.WHATSAPP_URL,
    });
  } catch (e) {
    console.error(e);
    return out(500, { error: "Erreur serveur" });
  }
};
