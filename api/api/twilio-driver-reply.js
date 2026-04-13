module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return res.status(500).send("Missing Supabase server credentials");
    }

    // Twilio sends form-encoded body by default
    const params = new URLSearchParams(req.body || "");
    const bodyRaw = (params.get("Body") || "").trim();
    const from = (params.get("From") || "").trim();

    const upper = bodyRaw.toUpperCase();
    const parts = upper.split(/\s+/);
    const command = parts[0];
    const loadId = parts[1] ? Number(parts[1]) : null;

    const headers = {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    };

    if (!from) {
      return twiml(res, "We could not read your phone number.");
    }

    if (!["YES", "NO"].includes(command)) {
      return twiml(
        res,
        "Reply YES {loadId} to accept or NO {loadId} to decline. Example: YES 12"
      );
    }

    if (!loadId || Number.isNaN(loadId)) {
      return twiml(
        res,
        "Missing load ID. Reply like YES 12 or NO 12."
      );
    }

    // Find the driver row by phone
    const driverRes = await fetch(
      `${supabaseUrl}/rest/v1/driver_locations?phone=eq.${encodeURIComponent(from)}&select=id,driver_name,truck_number&limit=1`,
      { headers }
    );
    const driverRows = await driverRes.json();

    if (!Array.isArray(driverRows) || !driverRows.length) {
      return twiml(res, "Your phone number is not linked to a driver profile.");
    }

    const driver = driverRows[0];

    // Find active dispatch for this load + driver
    const dispatchRes = await fetch(
      `${supabaseUrl}/rest/v1/dispatch_assignments?load_id=eq.${loadId}&driver_location_id=eq.${driver.id}&select=id,status&order=created_at.desc&limit=1`,
      { headers }
    );
    const dispatchRows = await dispatchRes.json();

    if (!Array.isArray(dispatchRows) || !dispatchRows.length) {
      return twiml(res, `No dispatch found for load ${loadId}.`);
    }

    const dispatch = dispatchRows[0];

    const dispatchStatus = command === "YES" ? "accepted" : "declined";
    const loadStatus = command === "YES" ? "accepted" : "declined";
    const tripEvent = command === "YES" ? "accepted" : "declined";
    const tripNote =
      command === "YES"
        ? `Driver accepted by SMS from ${from}`
        : `Driver declined by SMS from ${from}`;

    // Update dispatch assignment
    await fetch(
      `${supabaseUrl}/rest/v1/dispatch_assignments?id=eq.${dispatch.id}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          status: dispatchStatus,
          updated_at: new Date().toISOString(),
          note: tripNote
        })
      }
    );

    // Update load
    const loadPatch =
      command === "YES"
        ? {
            status: loadStatus,
            updated_at: new Date().toISOString()
          }
        : {
            status: loadStatus,
            decline_reason: `Driver declined by SMS from ${from}`,
            updated_at: new Date().toISOString()
          };

    await fetch(
      `${supabaseUrl}/rest/v1/loads?id=eq.${loadId}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify(loadPatch)
      }
    );

    // Insert trip event
    await fetch(
      `${supabaseUrl}/rest/v1/trip_events`,
      {
        method: "POST",
        headers,
        body: JSON.stringify([{
          load_id: loadId,
          event_type: tripEvent,
          note: tripNote
        }])
      }
    );

    return twiml(
      res,
      command === "YES"
        ? `Load ${loadId} accepted. Dispatch has been updated.`
        : `Load ${loadId} declined. Dispatch has been updated.`
    );
  } catch (error) {
    return twiml(res, `Error processing reply: ${error.message}`);
  }
};

function twiml(res, message) {
  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`
  );
}

function escapeXml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
