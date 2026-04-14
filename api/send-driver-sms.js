const trackingLink = `${process.env.APP_BASE_URL}/driver.html?loadId=${loadId}`;

const body =
  `FCC Dispatch Alert\n` +
  `Load: ${loadNumber}\n` +
  `Pickup: ${pickup}\n` +
  `Delivery: ${delivery}\n\n` +
  `📍 Start Tracking:\n${trackingLink}\n\n` +
  `Reply YES ${loadId} to accept\n` +
  `Reply NO ${loadId} to decline`;
