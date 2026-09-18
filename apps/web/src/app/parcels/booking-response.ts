export type PublicBookingResponse = {
  code?: string | null;
  serviceTicketNumber?: string | null;
  deliveryCode?: string | null;
};

export function normalizePublicBookingResponse(response: PublicBookingResponse) {
  const code = (response.code ?? response.serviceTicketNumber ?? '').trim();
  const serviceTicketNumber = (response.serviceTicketNumber ?? '').trim();
  const deliveryCode = (response.deliveryCode ?? '').trim();

  return {
    ok: true,
    code: code || serviceTicketNumber || '',
    serviceTicketNumber: serviceTicketNumber || code || '',
    deliveryCode,
  } as const;
}