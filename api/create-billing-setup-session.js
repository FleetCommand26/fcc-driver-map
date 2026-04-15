const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { email, companyName, companyType } = req.body || {};
    if (!email || !companyName || !companyType) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    let customer = null;

    const existing = await stripe.customers.list({ email, limit: 1 });
    if (existing.data.length) {
      customer = existing.data[0];
    } else {
      customer = await stripe.customers.create({
        email,
        name: companyName,
        metadata: { companyName, companyType }
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      customer: customer.id,
      success_url: `${process.env.APP_BASE_URL}/billing-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_BASE_URL}/pricing`,
    });

    return res.status(200).json({
      ok: true,
      url: session.url,
      stripe_customer_id: customer.id
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
};
