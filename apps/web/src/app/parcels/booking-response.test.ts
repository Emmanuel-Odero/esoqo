import test from "node:test";
import assert from "node:assert/strict";

import { normalizePublicBookingResponse } from "./booking-response.ts";

test("normalizePublicBookingResponse prefers the real parcel code while keeping the service ticket as secondary metadata", () => {
  assert.deepStrictEqual(
    normalizePublicBookingResponse({
      code: "PKG-AB12CD",
      serviceTicketNumber: "TCK-ZX99QJ",
      deliveryCode: "DEL-42",
    }),
    {
      ok: true,
      code: "PKG-AB12CD",
      serviceTicketNumber: "TCK-ZX99QJ",
      deliveryCode: "DEL-42",
    },
  );

  assert.deepStrictEqual(
    normalizePublicBookingResponse({
      serviceTicketNumber: "TCK-ZX99QJ",
      deliveryCode: "DEL-42",
    }),
    {
      ok: true,
      code: "TCK-ZX99QJ",
      serviceTicketNumber: "TCK-ZX99QJ",
      deliveryCode: "DEL-42",
    },
  );
});
