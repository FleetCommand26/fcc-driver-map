const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  try {
    const headers = {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    };

    const feesRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/load_fees?fee_status=eq.pending&select=*`,
      { headers }
    );
    const fees = await feesRes.json();

    const grouped = new Map();
    for (const fee of fees) {
      const key = `${fee.company_type}:${fee.company_name}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(fee);
    }

    for (const [key, items] of grouped.entries()) {
      const [companyType, companyName] = key.split(":");

      const acctRes = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/billing_accounts?company_name=eq.${encodeURIComponent(companyName)}&select=*`,
        { headers }
      );
      const acctRows = await acctRes.json();
      const acct = acctRows[0];
      if (!acct?.stripe_customer_id) continue;

      for (const item of items) {
        await stripe.invoiceItems.create({
          customer: acct.stripe_customer_id,
          amount: item.amount_cents,
          currency: item.currency || "usd",
          description: `${item.fee_name} | Load ${item.load_id}`
        });
      }

      const invoice = await stripe.invoices.create({
        customer: acct.stripe_customer_id,
        collection_method: "charge_automatically",
        auto_advance: true
      });

      const total = items.reduce((sum, x) => sum + Number(x.amount_cents || 0), 0);

      const invRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/fcc_invoices`, {
        method: "POST",
        headers,
        body: JSON.stringify([{
          company_name: companyName,
          company_type: companyType,
          stripe_customer_id: acct.stripe_customer_id,
          subtotal_cents: total,
          status: "open",
          stripe_invoice_id: invoice.id
        }])
      });
      const invRows = await invRes.json();
      const localInvoice = invRows[0];

      await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/load_fees?company_name=eq.${encodeURIComponent(companyName)}&fee_status=eq.pending`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            fee_status: "invoiced",
            invoice_id: localInvoice?.id || null,
            updated_at: new Date().toISOString()
          })
        }
      );

      await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/billing_accounts?company_name=eq.${encodeURIComponent(companyName)}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            current_balance_cents: total,
            updated_at: new Date().toISOString()
          })
        }
      );
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};
