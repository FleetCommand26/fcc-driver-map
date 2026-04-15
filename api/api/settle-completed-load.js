module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { loadId } = req.body || {};
    if (!loadId) return res.status(400).json({ error: "Missing loadId" });

    const headers = {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    };

    const loadRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/loads?id=eq.${loadId}&select=*`,
      { headers }
    );
    const loads = await loadRes.json();
    const load = loads[0];

    if (!load) return res.status(404).json({ error: "Load not found" });

    if (load.status !== "completed" || !load.pod_path) {
      return res.status(400).json({ error: "Load not ready for fee settlement" });
    }

    const rulesRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/fee_rules?trigger_event=eq.load_completed&is_active=eq.true&select=*`,
      { headers }
    );
    const rules = await rulesRes.json();

    const createdFees = [];

    for (const rule of rules) {
      let companyName = null;
      if (rule.company_type === "broker") companyName = load.broker_company;
      if (rule.company_type === "carrier" || rule.company_type === "owner") companyName = load.owner_company;

      if (!companyName) continue;

      const amountCents =
        rule.fee_type === "flat"
          ? Math.round(Number(rule.fee_value) * 100)
          : Math.round((Number(load.rate || 0) * Number(rule.fee_value) / 100) * 100);

      const feePayload = {
        load_id: load.id,
        company_name: companyName,
        company_type: rule.company_type,
        fee_name: rule.fee_name,
        fee_type: rule.fee_type,
        fee_value: rule.fee_value,
        amount_cents: amountCents,
        currency: "usd"
      };

      const feeRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/load_fees`, {
        method: "POST",
        headers,
        body: JSON.stringify([feePayload])
      });

      if (feeRes.ok) createdFees.push(feePayload);

      await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/billing_accounts?company_name=eq.${encodeURIComponent(companyName)}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            updated_at: new Date().toISOString()
          })
        }
      );
    }

    res.status(200).json({ ok: true, createdFees });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};
