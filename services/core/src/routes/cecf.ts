import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  startRegistration, updateRegistration, markMsisdnVerified, getRegistrationDetail,
  declarePayment, deferPayment,
  attachRegistrationCheckoutRequestId, attachRegistrationPesapalOrder,
  confirmRegistrationPaymentByCheckoutId, confirmRegistrationPaymentByPesapalOrderId,
  completeCecfRegistration, uploadCecfDocument, cecfRegistrantOrgRole,
  type Ctx,
} from '@esoko/db';
import { initiateStkPush, MpesaError, initiatePesapalOrder, PesapalError } from '@esoko/payments';
import { cecfIngestSchema, cecfDocumentUploadSchema, cecfMemberSchema, msisdnSchema } from '@esoko/domain';
import { z } from 'zod';

/**
 * The authenticated facade the CECF WordPress site's PHP backend calls —
 * see docs/proposals/cecf-wordpress-registration.md. WordPress never
 * talks to Daraja, Pesapal or the database directly; it talks to this,
 * which is a thin proxy over the *same* @esoko/db functions
 * apps/app/join's Server Actions already call. The one thing every route
 * here adds over those Server Actions is HMAC service authentication —
 * there is no browser session to trust, so a shared secret stands in for
 * "this really is the WordPress server, not anyone on the internet."
 *
 * Unlike the Safaricom-style webhooks below (always 200, log-and-move-
 * on), these are a synchronous API a human on the WordPress side is
 * actively waiting on, so real 4xx/5xx status codes are correct — a
 * failed save needs to reach the registrant as an error, not be silently
 * swallowed.
 */

function cecfCtx(): Ctx {
  return {
    actorType: 'STAFF',
    actorId: 'system:cecf-ingest',
    capabilities: ['*'],
    __verified: true,
  };
}

/**
 * Signs the exact bytes WordPress's PHP client sent — never
 * JSON.stringify(req.body). Re-serialising the *parsed* body would sign
 * Node's own re-encoding of it, not what the sender actually transmitted,
 * and PHP's json_encode and V8's JSON.stringify disagree often enough
 * (Unicode escaping, float formatting) that the two would routinely fail
 * to agree on a signature for the same logical payload. See the
 * addContentTypeParser override below, scoped to this plugin only, which
 * captures req.rawBody before parsing.
 */
function verifyCecfSignature(req: FastifyRequest & { rawBody?: string }): boolean {
  const secret = process.env.CECF_SERVICE_SECRET;
  if (!secret) return false; // never open the door because setup was skipped

  const signature = req.headers['x-cecf-signature'];
  if (typeof signature !== 'string' || !signature) return false;

  const expected = createHmac('sha256', secret).update(req.rawBody ?? '').digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

async function requireCecfAuth(req: FastifyRequest, reply: FastifyReply) {
  if (!verifyCecfSignature(req)) {
    return reply.code(401).send({ ok: false, error: 'Invalid or missing signature' });
  }
}

function sendError(reply: FastifyReply, e: unknown) {
  if (e instanceof MpesaError || e instanceof PesapalError) {
    return reply.code(422).send({ ok: false, error: e.message, code: e.code });
  }
  if (e instanceof z.ZodError) {
    const issue = e.issues[0];
    return reply.code(422).send({ ok: false, error: issue?.message ?? 'Invalid input', field: issue?.path.join('.') });
  }
  if (e instanceof Error) return reply.code(400).send({ ok: false, error: e.message });
  return reply.code(500).send({ ok: false, error: 'Something went wrong' });
}

export async function cecfRoutes(app: FastifyInstance) {
  // Encapsulated to this plugin only (Fastify plugins don't leak parser
  // overrides to the parent app) — captures the exact bytes received so
  // verifyCecfSignature can check them, then parses normally.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as FastifyRequest & { rawBody?: string }).rawBody = body as string;
    if (!body) { done(null, {}); return; }
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      e.statusCode = 400;
      done(e, undefined);
    }
  });

  app.addHook('preHandler', requireCecfAuth);

  /**
   * Everything WordPress collected — registrant, and group/business
   * detail — in one call. Mirrors actionStart + actionSaveNames/
   * Contact/Work/Standing from apps/app/join/actions.ts, just run
   * server-to-server in one pass instead of across a multi-step wizard.
   */
  app.post('/api/cecf/registration/start', async (req, reply) => {
    try {
      const v = cecfIngestSchema.parse(req.body);
      const ctx = cecfCtx();
      const r = v.registrant;

      const orgRole = v.joiningAs === 'group' ? cecfRegistrantOrgRole(v.registrantRole) : undefined;

      const reg = await startRegistration(ctx, {
        joiningAs: v.joiningAs,
        officialName: r.officialName,
        knownAs: r.knownAs || undefined,
        orgName: v.joiningAs === 'group' ? v.orgName : undefined,
        orgKnownAs: v.joiningAs === 'group' ? v.orgKnownAs : undefined,
        orgRole,
        belongsToGroup: v.joiningAs === 'group' ? 'yes' : undefined,
        feeCoverage: v.joiningAs === 'group' ? v.feeCoverage : undefined,
        path: 'CECF_WEB',
      });

      await updateRegistration(ctx, reg.id, {
        msisdn: r.msisdn,
        email: r.email || undefined,
        county: r.county,
        ward: r.ward || undefined,
        workRaw: r.workRaw || undefined,
        hasKraPin: r.hasKraPin,
        ...(v.joiningAs === 'group' ? {
          orgKind: v.orgKind,
          orgSubCounty: v.orgSubCounty,
          orgDistrict: v.orgDistrict,
          orgTags: v.orgTags,
          registrationNo: v.registrationNo,
          memberCount: v.memberCount,
          hasRegisteredBusiness: v.isRegistered === 'yes' ? 'yes' : v.isRegistered === 'started' ? 'soon' : 'no',
        } : {}),
        ...(v.joiningAs === 'biz' ? {
          bizName: v.bizName,
          bizSector: v.bizSector,
          bizType: v.bizType,
          bizTypeOther: v.bizTypeOther,
          bizIsRegistered: v.bizIsRegistered,
          bizIntendsToRegister: v.bizIntendsToRegister,
          registrationNo: v.registrationNo,
          bizEmployeeCount: v.bizEmployeeCount,
          bizRevenueGoodKes: v.bizRevenueGoodKes,
          bizRevenueBadKes: v.bizRevenueBadKes,
          bizBankProvider: v.bizBankProvider,
        } : {}),
        // Verification already happened on WordPress's own side (its
        // form collects and confirms the number before ever calling
        // here) — this only records that fact, it never re-runs OTP.
        ...(r.msisdnVerified ? { lastStep: 9 } : {}),
      });

      if (r.msisdnVerified) {
        await markMsisdnVerified(ctx, reg.id);
      }

      return reply.send({ ok: true, registrationId: reg.id });
    } catch (e) { return sendError(reply, e); }
  });

  app.post<{ Params: { id: string } }>(
    '/api/cecf/registration/:id/documents',
    // Base64-encoded file bytes blow past the service's default 256KB
    // body limit fast — MAX_BYTES (10MB) per file, up to 6 files, plus
    // ~33% base64 overhead. This route alone gets a much larger ceiling;
    // every other route keeps the tight default.
    { bodyLimit: 15 * 1024 * 1024 },
    async (req, reply) => {
      try {
        const body = z.object({ documents: z.array(cecfDocumentUploadSchema).min(1).max(6) }).parse(req.body);
        const docs = [];
        for (const doc of body.documents) {
          docs.push(await uploadCecfDocument(req.params.id, doc));
        }
        return reply.send({ ok: true, documents: docs.map((d) => ({ id: d.id, title: d.title, kind: d.kind })) });
      } catch (e) { return sendError(reply, e); }
    },
  );

  app.post<{ Params: { id: string } }>('/api/cecf/registration/:id/pay-later', async (req, reply) => {
    try {
      await deferPayment(cecfCtx(), req.params.id);
      return reply.send({ ok: true });
    } catch (e) { return sendError(reply, e); }
  });

  const mpesaInitiateSchema = z.object({
    registrationId: z.string().uuid(),
    msisdn: msisdnSchema,
    amountKes: z.coerce.number().int().min(1).max(1_000_000),
  });

  app.post('/api/cecf/payments/mpesa/initiate', async (req, reply) => {
    try {
      const v = mpesaInitiateSchema.parse(req.body);
      const ctx = cecfCtx();
      const push = await initiateStkPush({
        msisdn: v.msisdn, amountKes: v.amountKes,
        accountReference: `CECF${v.registrationId.slice(0, 8)}`,
        description: 'CECF Reg Fee',
      });
      await attachRegistrationCheckoutRequestId(ctx, v.registrationId, push.checkoutRequestId, v.amountKes, v.msisdn);
      if (push.autoConfirmed) {
        await confirmRegistrationPaymentByCheckoutId(push.checkoutRequestId, push.mpesaReceiptCode ?? '');
        return reply.send({ ok: true, status: 'CONFIRMED' });
      }
      return reply.send({ ok: true, status: 'DECLARED' });
    } catch (e) { return sendError(reply, e); }
  });

  const pesapalInitiateSchema = z.object({
    registrationId: z.string().uuid(),
    amountKes: z.coerce.number().int().min(1).max(1_000_000),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    returnUrl: z.string().url(),
  });

  app.post('/api/cecf/payments/pesapal/initiate', async (req, reply) => {
    try {
      const v = pesapalInitiateSchema.parse(req.body);
      const ctx = cecfCtx();
      const order = await initiatePesapalOrder({
        merchantReference: v.registrationId,
        amountKes: v.amountKes,
        description: 'CECF registration fee',
        email: v.email, phone: v.phone, firstName: v.firstName, lastName: v.lastName,
        returnUrl: v.returnUrl,
      });
      await attachRegistrationPesapalOrder(ctx, v.registrationId, order.orderTrackingId, v.amountKes);
      if (order.autoConfirmed) {
        await confirmRegistrationPaymentByPesapalOrderId(order.orderTrackingId);
      }
      return reply.send({ ok: true, redirectUrl: order.redirectUrl, orderTrackingId: order.orderTrackingId });
    } catch (e) { return sendError(reply, e); }
  });

  app.get<{ Params: { id: string } }>('/api/cecf/payments/:id/status', async (req, reply) => {
    try {
      const detail = await getRegistrationDetail(cecfCtx(), req.params.id);
      return reply.send({ ok: true, status: detail?.payment?.status ?? 'NOT_DECLARED' });
    } catch (e) { return sendError(reply, e); }
  });

  const completeSchema = z.object({
    members: z.array(cecfMemberSchema).max(500).optional(),
  });

  app.post<{ Params: { id: string } }>('/api/cecf/registration/:id/complete', async (req, reply) => {
    try {
      const v = completeSchema.parse(req.body ?? {});
      const result = await completeCecfRegistration(req.params.id, { members: v.members });
      return reply.send({
        ok: true,
        partyId: result.partyId,
        orgPartyId: result.orgPartyId,
        bizPartyId: result.bizPartyId,
        roster: result.roster,
      });
    } catch (e) { return sendError(reply, e); }
  });

  // Declared-only methods (bank transfer, cash to agent) — same shape as
  // apps/app/join/upload.ts's actionDeclarePayment.
  const declareSchema = z.object({
    method: z.enum(['BANK_TRANSFER', 'CASH_TO_AGENT']),
    reference: z.string().optional(),
    amountKes: z.coerce.number().optional(),
    note: z.string().optional(),
  });

  app.post<{ Params: { id: string } }>('/api/cecf/registration/:id/declare-payment', async (req, reply) => {
    try {
      const v = declareSchema.parse(req.body);
      await declarePayment(cecfCtx(), req.params.id, v);
      return reply.send({ ok: true });
    } catch (e) { return sendError(reply, e); }
  });
}
