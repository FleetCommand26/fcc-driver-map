module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      to,
      loadId,
      loadNumber,
      pickup,
      delivery,
      driverName
    } = req.body || {};

    if (!to) {
      return res.status(400).json({ error: "Missing driver phone number" });
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

    if (!accountSid || !authToken || !messagingServiceSid) {
      return res.status(500).json({ error: "Missing Twilio environment variables" });
    }

    const body =
      `FCC Dispatch Alert\n` +
      `Driver: ${driverName || "Driver"}\n` +
      `Load: ${loadNumber || "N/A"}\n` +
      `Pickup: ${pickup || "N/A"}\n` +
      `Delivery: ${delivery || "N/A"}\n\n` +
      `Reply YES ${loadId} to accept.\n` +
      `Reply NO ${loadId} to decline.`;

    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

    const params = new URLSearchParams();
    params.append("To", to);
    params.append("Body", body);
    params.append("MessagingServiceSid", messagingServiceSid);

    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: params.toString()
      }
    );

    const data = await twilioRes.json();

    if (!twilioRes.ok) {
      return res.status(500).json({
        ok: false,
        error: data.message || "Twilio send failed",
        details: data
      });
    }

    return res.status(200).json({
      ok: true,
      sid: data.sid,
      status: data.status
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Unexpected error"
    });
  }
};
