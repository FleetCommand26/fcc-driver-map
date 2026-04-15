const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      if (session.mode === "setup" && session.customer) {
        const customer = await stripe.customers.retrieve(session.customer);
        const paymentMethods = await stripe.paymentMethods.list({
          customer: session.customer,
          type: "card"
        });

        const defaultPm = paymentMethods.data[0]?.id || null;

        await fetch(`${process.env.SUPABASE_URL}/rest/v1/billing_accounts?company_name=eq.${encodeURIComponent(customer.name)}`, {
          method: "PATCH",
          headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal"
          },
          body: JSON.stringify({
            stripe_customer_id: session.customer,
            default_payment_method_id: defaultPm,
            billing_status: "active",
            updated_at: new Date().toISOString()
          })
        });
      }
    }

    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object;
      await fetch(`${process.env.SUPABASE_URL}/rest/v1/billing_accounts?stripe_customer_id=eq.${invoice.customer}`, {
        method: "PATCH",
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify({
          billing_status: "past_due",
          updated_at: new Date().toISOString()
        })
      });
    }

    if (event.type === "invoice.paid") {
      const invoice = event.data.object;
      await fetch(`${process.env.SUPABASE_URL}/rest/v1/billing_accounts?stripe_customer_id=eq.${invoice.customer}`, {
        method: "PATCH",
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify({
          billing_status: "active",
          current_balance_cents: 0,
          updated_at: new Date().toISOString()
        })
      });
    }

    res.status(200).json({ received: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
