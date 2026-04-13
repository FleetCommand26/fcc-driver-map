module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { loadId, reason = "auto_reassign" } = req.body || {};
    if (!loadId) {
      return res.status(400).json({ error: "Missing loadId" });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRole) {
      return res.status(500).json({ error: "Missing Supabase server credentials" });
    }

    const headers = {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    };

    const loadRes = await fetch(
      `${supabaseUrl}/rest/v1/loads?id=eq.${loadId}&select=*`,
      { headers }
    );
    const loadRows = await loadRes.json();
    const load = loadRows[0];

    if (!load) {
      return res.status(404).json({ error: "Load not found" });
    }

    const assignmentsRes = await fetch(
      `${supabaseUrl}/rest/v1/dispatch_assignments?load_id=eq.${loadId}&select=*`,
      { headers }
    );
    const assignments = await assignmentsRes.json();

    const excludedDriverIds = new Set(
      (assignments || []).map(a => a.driver_location_id).filter(Boolean)
    );
    if (load.last_declined_driver_id) excludedDriverIds.add(load.last_declined_driver_id);

    const driversRes = await fetch(
      `${supabaseUrl}/rest/v1/driver_locations?select=*`,
      { headers }
    );
    const drivers = await driversRes.json();

    const eligible = (drivers || []).filter(d =>
      d &&
      d.id &&
      d.lat != null &&
      d.lng != null &&
      d.phone &&
      d.is_tracking === true &&
      !excludedDriverIds.has(d.id)
    );

    if (!eligible.length) {
      await fetch(
        `${supabaseUrl}/rest/v1/trip_events`,
        {
          method: "POST",
          headers,
          body: JSON.stringify([{
            load_id: loadId,
            event_type: "assigned",
            note: `Auto-reassign failed: no eligible next driver for reason ${reason}`
          }])
        }
      );

      return res.status(200).json({ ok: false, message: "No eligible next driver found" });
    }

    const haversineMiles = (lat1, lon1, lat2, lon2) => {
      const R = 3958.8;
      const toRad = d => d * Math.PI / 180;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const pickupLat = load.pickup_lat ?? 0;
    const pickupLng = load.pickup_lng ?? 0;

    const ranked = eligible
      .map(d => ({
        ...d,
        distance_miles: haversineMiles(pickupLat, pickupLng, d.lat, d.lng)
      }))
      .sort((a, b) => a.distance_miles - b.distance_miles);

    const nextDriver = ranked[0];

    const insertAssignmentRes = await fetch(
      `${supabaseUrl}/rest/v1/dispatch_assignments`,
      {
        method: "POST",
        headers,
        body: JSON.stringify([{
          load_id: loadId,
          driver_location_id: nextDriver.id,
          assigned_by: load.created_by,
          status: "assigned",
          note: `Auto reassigned: ${reason}`,
          auto_reassign_attempt: (load.auto_reassign_count || 0) + 1
        }])
      }
    );
    const newAssignments = await insertAssignmentRes.json();
    const newAssignment = Array.isArray(newAssignments) ? newAssignments[0] : null;

    await fetch(
      `${supabaseUrl}/rest/v1/loads?id=eq.${loadId}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          assigned_driver_location_id: nextDriver.id,
          status: "assigned",
          sms_response_status: null,
          auto_reassign_count: (load.auto_reassign_count || 0) + 1,
          updated_at: new Date().toISOString()
        })
      }
    );

    await fetch(
      `${supabaseUrl}/rest/v1/trip_events`,
      {
        method: "POST",
        headers,
        body: JSON.stringify([{
          load_id: loadId,
          event_type: "assigned",
          note: `Auto reassigned to ${nextDriver.driver_name || "driver"} for reason: ${reason}`
        }])
      }
    );

    await fetch(`${req.headers.origin || ""}/api/send-driver-sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: nextDriver.phone,
        driverName: nextDriver.driver_name,
        loadId: load.id,
        loadNumber: load.load_number,
        pickup: load.pickup_name,
        delivery: load.delivery_name,
        dispatchAssignmentId: newAssignment?.id,
        replyMinutes: 5
      })
    }).catch(() => {});

    return res.status(200).json({
      ok: true,
      nextDriverId: nextDriver.id,
      nextDriverName: nextDriver.driver_name,
      distanceMiles: nextDriver.distance_miles
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
};
