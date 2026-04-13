module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const appBaseUrl = process.env.APP_BASE_URL;

    if (!supabaseUrl || !serviceRole || !appBaseUrl) {
      return res.status(500).json({ error: "Missing server environment variables" });
    }

    const headers = {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    };

    const nowIso = new Date().toISOString();

    const resDispatch = await fetch(
      `${supabaseUrl}/rest/v1/dispatch_assignments?status=eq.assigned&sms_sent_at=not.is.null&sms_reply_received_at=is.null&sms_reply_deadline_at=lt.${encodeURIComponent(nowIso)}&select=*`,
      { headers }
    );

    const staleAssignments = await resDispatch.json();

    let processed = 0;

    for (const assignment of staleAssignments || []) {
      await fetch(
        `${supabaseUrl}/rest/v1/dispatch_assignments?id=eq.${assignment.id}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            status: "declined",
            note: "Auto-declined for no SMS reply",
            updated_at: nowIso
          })
        }
      );

      await fetch(
        `${supabaseUrl}/rest/v1/loads?id=eq.${assignment.load_id}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            status: "declined",
            sms_response_status: "no_reply",
            last_declined_driver_id: assignment.driver_location_id,
            decline_reason: "No SMS reply before deadline",
            updated_at: nowIso
          })
        }
      );

      await fetch(
        `${supabaseUrl}/rest/v1/trip_events`,
        {
          method: "POST",
          headers,
          body: JSON.stringify([{
            load_id: assignment.load_id,
            event_type: "declined",
            note: "Auto-declined for no SMS reply"
          }])
        }
      );

      await fetch(`${appBaseUrl}/api/auto-reassign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loadId: assignment.load_id,
          reason: "no_sms_reply"
        })
      });

      processed += 1;
    }

    return res.status(200).json({ ok: true, processed });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
};
