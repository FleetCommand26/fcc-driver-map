module.exports = async (req, res) => {
  try {
    const headers = {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    };

    const acctRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/billing_accounts?billing_status=eq.past_due&select=*`,
      { headers }
    );
    const accounts = await acctRes.json();

    for (const acct of accounts) {
      await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/billing_accounts?id=eq.${acct.id}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            billing_status: "locked",
            updated_at: new Date().toISOString()
          })
        }
      );
    }

    res.status(200).json({ ok: true, locked: accounts.length });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};
