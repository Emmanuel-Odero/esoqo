import { prisma } from "../client";
import { allocateEsoqoOrgHandle } from "./payment-id";
import { requireCapability, systemCtx, type Ctx } from "../capabilities";
import { recordAudit } from "../audit";
import type {
  JoinPath,
  RegistrationStatus,
  PartyKind,
  OrgKind,
  MemberRole,
} from "@prisma/client";

/* ── inputs ─────────────────────────────────────────────────── */

export interface StartRegistrationInput {
  joiningAs: "me" | "group" | "biz";
  /// Required so a registration is never persisted before there is a real
  /// person behind it — an empty shell row that nobody ever finishes is
  /// not a draft, it's noise (see the July 2026 data cleanup).
  officialName: string;
  knownAs?: string;
  orgName?: string;
  orgKnownAs?: string;
  orgRole?: string;
  /// The join flow now asks group membership before the name is even
  /// saved, so these can already be known at creation time.
  belongsToGroup?: string;
  groupName?: string;
  groupPartyId?: string;
  feeCoverage?: string;
  lastStep?: number;
  language?: string;
  path?: JoinPath;
  agentId?: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface UpdateRegistrationInput {
  officialName?: string;
  knownAs?: string;
  firstName?: string;
  middleName?: string;
  surname?: string;
  dateOfBirth?: Date;
  msisdn?: string;
  email?: string;
  county?: string;
  ward?: string;
  workRaw?: string;
  segment?: string;
  orgName?: string;
  orgKnownAs?: string;
  orgRole?: string;
  memberCount?: number;
  hasRegisteredBusiness?: string;
  registrationNo?: string;
  belongsToGroup?: string;
  groupName?: string;
  groupPartyId?: string;
  feeCoverage?: string;
  hasKraPin?: string;
  wantsPriceSms?: boolean;
  wantsReceiptSms?: boolean;
  wantsExpirySms?: boolean;
  ussdSetupChoice?: "now" | "later";
  lastStep?: number;
  /// New-group detail — only set when GroupDetails (not GroupSearch) ran.
  orgKind?: string;
  orgSubCounty?: string;
  orgDistrict?: string;
  orgTags?: string[];
  /// Business sub-flow.
  bizName?: string;
  bizIsRegistered?: string;
  bizIntendsToRegister?: string;
  bizPartyId?: string;
  /// SUPPLIER | WHOLESALER | WAREHOUSE | MALL | BUSINESS (default) — which
  /// OrgKind completeRegistration gives the new Organisation.
  bizOrgKind?: string;
  bizSector?: string;
  bizType?: string;
  bizTypeOther?: string;
  bizEmployeeCount?: number;
  bizRevenueGoodKes?: number;
  bizRevenueBadKes?: number;
  bizBankProvider?: string;
  bizPaymentChannels?: string[];
}

/** Maps the free-typed "role in the group" onto the fixed Membership
 *  enum. A custom role (e.g. "Auditor") has nowhere to live on the strict
 *  enum, so it defaults to MEMBER — the typed text itself stays visible
 *  on Registration.orgRole for admin/history. */
function toMemberRole(orgRole: string | null | undefined): MemberRole {
  const known: Record<string, MemberRole> = {
    chairperson: "CHAIRPERSON",
    treasurer: "TREASURER",
    secretary: "SECRETARY",
    member: "MEMBER",
  };
  return known[orgRole?.trim().toLowerCase() ?? ""] ?? "MEMBER";
}

/* ── writes ─────────────────────────────────────────────────── */

export async function startRegistration(
  ctx: Ctx,
  input: StartRegistrationInput,
) {
  requireCapability(ctx, "registration.create");
  if (!input.officialName?.trim()) {
    throw new Error("A name is required to start a registration");
  }

  const reg = await prisma.registration.create({
    data: {
      joiningAs: input.joiningAs,
      officialName: input.officialName.trim(),
      knownAs: input.knownAs || undefined,
      orgName: input.orgName || undefined,
      orgKnownAs: input.orgKnownAs || undefined,
      orgRole: input.orgRole || undefined,
      belongsToGroup: input.belongsToGroup || undefined,
      groupName: input.groupName || undefined,
      groupPartyId: input.groupPartyId || undefined,
      feeCoverage: input.feeCoverage || undefined,
      lastStep: input.lastStep ?? 1,
      language: input.language ?? "en",
      path: input.path ?? "SELF_WEB",
      agentId: input.agentId,
      ip: input.ip ?? undefined,
      userAgent: input.userAgent ?? undefined,
      status: "STARTED",
    },
  });

  await recordAudit(ctx, {
    action: "registration.started",
    targetType: "registration",
    targetId: reg.id,
    payload: { joiningAs: input.joiningAs, path: reg.path },
  });

  return reg;
}

export async function updateRegistration(
  ctx: Ctx,
  id: string,
  input: UpdateRegistrationInput,
) {
  requireCapability(ctx, "registration.write", { registrationId: id });

  const existing = await prisma.registration.findUnique({ where: { id } });
  if (!existing) throw new Error("Registration not found");
  if (existing.status === "COMPLETE") {
    throw new Error("Registration already complete and cannot be edited");
  }

  // Never move backwards — going "Back" in the flow to edit an earlier
  // answer must not make a further-along drop-off look like an earlier one.
  const { lastStep, ...rest } = input;
  const reg = await prisma.registration.update({
    where: { id },
    data: {
      ...rest,
      ...(lastStep && lastStep > existing.lastStep ? { lastStep } : {}),
    },
  });

  // Audit the SHAPE of what changed, never the values. A phone number in
  // an audit payload is a data-protection problem waiting to be found.
  await recordAudit(ctx, {
    action: "registration.updated",
    targetType: "registration",
    targetId: id,
    payload: { fields: Object.keys(input) },
  });

  // The number just attached is the earliest point we can tell this is
  // the same person as an existing open attempt (localStorage lost, tab
  // reopened, "start over" clicked) — auto-void the older one rather than
  // let duplicates accumulate silently, per the July 2026 data cleanup.
  if (input.msisdn) {
    const dupes = await prisma.registration.findMany({
      where: {
        msisdn: input.msisdn,
        status: { not: "COMPLETE" },
        id: { not: id },
      },
    });
    for (const dup of dupes) {
      await prisma.registration.update({
        where: { id: dup.id },
        data: {
          status: "ABANDONED",
          voidedAt: new Date(),
          voidReason:
            "Superseded by a newer attempt with the same phone number",
        },
      });
      await recordAudit(systemCtx("duplicate-supersede"), {
        action: "registration.voided",
        targetType: "registration",
        targetId: dup.id,
        payload: { reason: "duplicate_msisdn", supersededBy: id },
      });
    }
  }

  return reg;
}

/**
 * Sets which group a not-yet-complete registration is destined for —
 * the narrow membership-only counterpart to assignPersonToGroup (which
 * needs a real Party, only created at completion). Gated by
 * membership.write, not registration.write: assigning someone to a
 * group is a membership decision, and a staff account trusted to make
 * that call shouldn't ALSO need the broader "can edit any field on any
 * registration" permission just to reach it — that mismatch is exactly
 * what made this look like "only works on completed registrations"
 * before, when the real blocker was which capability the UI checked.
 *
 * Purely intent — completeRegistration's own linking step (2c) is what
 * actually creates the Membership once this registration finishes.
 */
export async function setRegistrationGroupIntent(
  ctx: Ctx,
  id: string,
  orgPartyId: string,
  orgName: string,
) {
  requireCapability(ctx, "membership.write", { partyId: orgPartyId });

  const existing = await prisma.registration.findUnique({ where: { id } });
  if (!existing) throw new Error("Registration not found");
  if (existing.status === "COMPLETE") {
    throw new Error(
      "Already complete — use assignPersonToGroup instead, this registration has a real Party now",
    );
  }

  const reg = await prisma.registration.update({
    where: { id },
    data: {
      groupPartyId: orgPartyId,
      groupName: orgName,
      belongsToGroup: "yes",
    },
  });

  await recordAudit(ctx, {
    action: "registration.group_intent_set",
    targetType: "registration",
    targetId: id,
    payload: { orgPartyId },
  });

  return reg;
}

export async function markOtpSent(ctx: Ctx, id: string) {
  requireCapability(ctx, "registration.write", { registrationId: id });
  const reg = await prisma.registration.update({
    where: { id },
    data: { status: "AWAITING_OTP" },
  });
  await recordAudit(ctx, {
    action: "registration.otp_sent",
    targetType: "registration",
    targetId: id,
  });
  return reg;
}

export async function markMsisdnVerified(ctx: Ctx, id: string) {
  requireCapability(ctx, "registration.write", { registrationId: id });
  const reg = await prisma.registration.update({
    where: { id },
    data: { status: "VERIFIED", msisdnVerifiedAt: new Date() },
  });
  await recordAudit(ctx, {
    action: "registration.msisdn_verified",
    targetType: "registration",
    targetId: id,
  });
  return reg;
}

/** Email counterpart to markMsisdnVerified — set once whatever channel
 *  confirms an emailed code has done so. completeRegistration accepts
 *  either this or msisdnVerifiedAt as satisfying "verify a contact". */
export async function markEmailVerified(ctx: Ctx, id: string) {
  requireCapability(ctx, "registration.write", { registrationId: id });
  const reg = await prisma.registration.update({
    where: { id },
    data: { status: "VERIFIED", emailVerifiedAt: new Date() },
  });
  await recordAudit(ctx, {
    action: "registration.email_verified",
    targetType: "registration",
    targetId: id,
  });
  return reg;
}

/**
 * Converts a completed registration into a real Party.
 *
 * Everything happens in one transaction, audit included. A registration
 * that is not COMPLETE never becomes a Party — which is precisely how a
 * pre-provisioned or abandoned record avoids being counted as a user.
 */
export async function completeRegistration(ctx: Ctx, id: string) {
  requireCapability(ctx, "registration.write", { registrationId: id });

  return prisma.$transaction(async (tx) => {
    const reg = await tx.registration.findUnique({ where: { id } });
    if (!reg) throw new Error("Registration not found");
    if (reg.status === "COMPLETE")
      return { registration: reg, partyId: reg.partyId! };
    if (!reg.county) throw new Error("Cannot complete without a county");
    if (!reg.officialName)
      throw new Error("Cannot complete without an official name");

    // A person's esoqo handle is derived from their names, so firstName
    // and surname are compulsory and officialName alone is not enough.
    // Completing with one freeform name would mint a handle built from a
    // single word ("john482") or fail outright, and either way the person
    // ends up with an identifier nobody can read back to them. middleName
    // stays optional.
    if (!reg.firstName?.trim() || !reg.surname?.trim()) {
      throw new Error("Cannot complete without a first name and a surname");
    }

    // Phone number is required for completion. While email verification is
    // optional for later communication, phone is the primary sign-in identifier
    // (UserCredential and OTP are keyed on msisdn). Completing without a verified
    // phone would create an account that cannot be accessed. Email can be added
    // after account creation, but cannot be the sole verification method.
    const msisdnVerified = Boolean(reg.msisdn && reg.msisdnVerifiedAt);
    if (!msisdnVerified) {
      throw new Error(
        "Verify your phone number before completing registration — this is how you'll sign in",
      );
    }

    // Phone number reuse prevention: when a phone matches an existing Person,
    // we create a NEW Party instead of reusing the old one, and record an
    // audit event. This prevents different family members on a shared phone
    // from inadvertently sharing one account, wallet, and identity.
    //
    // A new registration on a phone that already has an account must be
    // explicitly confirmed. This is done via a new "account exists on this
    // number" check that will be triggered in the UI BEFORE OTP verification.
    // See actionVerifyJoinOtp for the registration.phoneExistsWarningAcknowledged
    // check that enforces this.
    //
    // For invites (pre-provisioned memberships), the phone MUST match the invite
    // exactly. If it doesn't, no membership attaches (see Gap 2 fix in DetailsForm).
    // The invite case is OK to reuse because the membership was created to tie to
    // that specific phone number in the first place.
    const existingPerson = reg.msisdn
      ? await tx.person.findUnique({ where: { msisdn: reg.msisdn } })
      : reg.email
        ? await tx.person.findFirst({ where: { email: reg.email } })
        : null;

    // The esoqo ID generator wants 2-3 discrete names, not one freeform
    // string — reg.firstName/surname are only populated when the newer
    // split-name form ran; officialName is kept as the derived display
    // string either way.
    const names = [reg.firstName, reg.middleName, reg.surname].filter(
      (n): n is string => Boolean(n?.trim()),
    );
    const derivedOfficialName =
      names.length > 0 ? names.join(" ") : reg.officialName;

    // 1 · the person — reuse if we matched one, otherwise create
    // 1 · the person — create NEW party by default (don't reuse).
    //
    // For invites (reg.belongsToGroup === 'yes' OR reg.groupPartyId): reuse if phone matches
    // the existing person, since the invite WAS created for that person's
    // phone number. The pre-provisioned membership depends on it.
    //
    // For all other cases (self registration, new group, new business):
    // create a new Person. Shared phones (family lines, group contact numbers)
    // are now treated as "different people sharing a phone" rather than
    // "same account with confusing ownership". This prevents accidental
    // account takeover and wallet/group membership sharing.
    //
    // If it really is the same person returning, sign-in will find them
    // via the phone number lookup (msisdn is @unique in UserCredential
    // and OTP tables), and auth will return them to their existing account.
    // No functionality is lost; UX is clearer.
    let personPartyId: string;
    const reuseExistingPerson = Boolean(
      existingPerson && (reg.belongsToGroup === "yes" || reg.groupPartyId),
    );

    if (existingPerson && reuseExistingPerson) {
      personPartyId = existingPerson.partyId;
    } else {
      const personParty = await tx.party.create({
        data: {
          kind: "PERSON" as PartyKind,
          sourceSystem: reg.path === "CECF_WEB" ? "CECF" : "ESOKO",
          county: reg.county,
          ward: reg.ward,
          person: {
            create: {
              officialName: derivedOfficialName,
              knownAs: reg.knownAs,
              firstName: reg.firstName,
              middleName: reg.middleName,
              surname: reg.surname,
              dateOfBirth: reg.dateOfBirth,
              yearOfBirth: reg.dateOfBirth
                ? reg.dateOfBirth.getFullYear()
                : undefined,
              msisdn: reg.msisdn,
              email: reg.email,
              msisdnVerifiedAt: reg.msisdnVerifiedAt,
              emailVerifiedAt: reg.emailVerifiedAt,
            },
          },
          accounts: { create: [{ kind: "WALLET", currency: "KES" }] },
        },
      });
      personPartyId = personParty.id;

      // Attestation only makes sense for the number we just verified
      // ourselves during this flow — an existing Person's verification
      // (or lack of it) is untouched by someone else's registration.
      if (reg.msisdnVerifiedAt) {
        await tx.attestation.create({
          data: {
            subjectId: personPartyId,
            claimType: "MSISDN_VERIFIED",
            claimValue: { msisdn: reg.msisdn },
            method: "API",
            issuedAt: reg.msisdnVerifiedAt,
          },
        });
      }
    }

    // 2 · a brand-new group, only when GroupDetails ran (orgName set and
    // no groupPartyId — search-before-create came up empty and they chose
    // to register it). Joining an org already picked via search happens
    // in 2c below, regardless of which top-level path (group/biz/me) got
    // them there.
    //
    // To prevent duplicate organizations (Gap 4), check if one already exists
    // with the same name, kind, and county. If it does, link to that instead
    // of creating a new one.
    let orgPartyId: string | null = null;
    if (reg.orgName && !reg.groupPartyId) {
      // Check for existing org with same name, kind, and county
      const existingOrg = await tx.organisation.findFirst({
        where: {
          officialName: reg.orgName.trim(),
          kind: (reg.orgKind ?? "OTHER") as OrgKind,
          party: { county: reg.county },
        },
        select: { partyId: true },
      });

      if (existingOrg) {
        // Link to existing org instead of creating duplicate
        orgPartyId = existingOrg.partyId;
        await tx.membership.upsert({
          where: {
            personId_orgId: { personId: personPartyId, orgId: orgPartyId },
          },
          create: {
            personId: personPartyId,
            orgId: orgPartyId,
            role: toMemberRole(reg.orgRole),
          },
          update: { exitedAt: null }, // Reinstate if previously exited
        });
      } else {
        // Create new org only if no duplicate exists
        const orgParty = await tx.party.create({
          data: {
            kind: "ORGANISATION" as PartyKind,
            sourceSystem: reg.path === "CECF_WEB" ? "CECF" : "ESOKO",
            county: reg.county,
            ward: reg.ward,
            subCounty: reg.orgSubCounty,
            district: reg.orgDistrict,
            organisation: {
              create: {
                kind: (reg.orgKind ?? "OTHER") as OrgKind,
                officialName: reg.orgName,
                knownAs: reg.orgKnownAs,
                registrationNo: reg.registrationNo,
                memberCount: reg.memberCount,
                tags: reg.orgTags,
              },
            },
            accounts: { create: [{ kind: "GROUP_SAVINGS", currency: "KES" }] },
          },
        });
        orgPartyId = orgParty.id;

        await tx.membership.create({
          data: {
            personId: personPartyId,
            orgId: orgParty.id,
            role: toMemberRole(reg.orgRole),
          },
        });

        // A group gets its handle at creation, same as a business above —
        // a group that exists but cannot be paid or recognised on a printed
        // stand is half-registered.
        await allocateEsoqoOrgHandle(
          orgParty.id,
          reg.orgName!,
          null,
          tx as never,
        );
      }
    }

    // 2b · a brand-new business, mirrors 2 — bizName set and no
    // bizPartyId (the live search came up empty). Gets its own
    // Organisation(kind: BUSINESS) + Enterprise (operational detail)
    // rather than an Enterprise hanging off the individual, so it is a
    // first-class, searchable, dedupe-checked party like any group.
    let bizPartyId: string | null = null;
    if (reg.joiningAs === "biz" && reg.bizName && !reg.bizPartyId) {
      const bizParty = await tx.party.create({
        data: {
          kind: "ORGANISATION" as PartyKind,
          sourceSystem: reg.path === "CECF_WEB" ? "CECF" : "ESOKO",
          county: reg.county,
          ward: reg.ward,
          organisation: {
            create: {
              kind: (reg.bizOrgKind || "BUSINESS") as OrgKind,
              officialName: reg.bizName,
              registrationNo:
                reg.bizIsRegistered === "yes" ? reg.registrationNo : null,
              businessType: reg.bizType,
              businessTypeOther: reg.bizTypeOther,
              intendsToRegister:
                reg.bizIsRegistered === "no"
                  ? reg.bizIntendsToRegister === "yes"
                  : null,
            },
          },
          accounts: { create: [{ kind: "WALLET", currency: "KES" }] },
        },
      });
      bizPartyId = bizParty.id;

      await tx.enterprise.create({
        data: {
          partyId: bizPartyId,
          workRaw: reg.bizSector ?? reg.bizName,
          segment: reg.bizSector,
          sector: reg.bizSector,
          isRegistered: reg.bizIsRegistered === "yes",
          hasKraPin: reg.hasKraPin === "yes",
          employeeCount: reg.bizEmployeeCount,
          revenueGoodDayKes: reg.bizRevenueGoodKes,
          revenueBadDayKes: reg.bizRevenueBadKes,
          bankProvider: reg.bizBankProvider,
          paymentChannels: reg.bizPaymentChannels,
        },
      });

      await tx.membership.create({
        data: {
          personId: personPartyId,
          orgId: bizPartyId,
          role: "OTHER",
          customRole: "Owner",
        },
      });

      // A business that cannot be paid is not registered as far as any
      // till is concerned, so it gets an Esoqo Payment ID the moment it
      // exists — a customer's printed QR has to resolve on the day the
      // stand goes up, not after some later approval step nobody has
      // built yet.
      //
      // The trust question is answered by the owner membership created
      // immediately above, not by an MSISDN_VERIFIED attestation:
      // an ORGANISATION has no phone number to attest to, which is
      // exactly why issueEsoqoPaymentId refuses it and this does not.
      //
      // Derived from the business's own name, allocated on the same
      // transaction as the business itself — minting outside it would
      // leave a payment ID pointing at an org a rollback erased.
      await allocateEsoqoOrgHandle(bizPartyId, reg.bizName, null, tx as never);
    }

    // 2c · linking to an org already picked via search — a group, a
    // business, or both. Idempotent: reusing an existing phone (1 above)
    // can mean this person is already a member, and re-adding them must
    // reinstate rather than crash on the unique (personId, orgId) index.
    for (const targetOrgId of [reg.groupPartyId, reg.bizPartyId].filter(
      (x): x is string => Boolean(x),
    )) {
      const existingMembership = await tx.membership.findUnique({
        where: {
          personId_orgId: { personId: personPartyId, orgId: targetOrgId },
        },
      });
      if (existingMembership) {
        if (existingMembership.exitedAt) {
          await tx.membership.update({
            where: { id: existingMembership.id },
            data: { exitedAt: null },
          });
        }
      } else {
        await tx.membership.create({
          data: {
            personId: personPartyId,
            orgId: targetOrgId,
            role:
              targetOrgId === reg.bizPartyId
                ? "OTHER"
                : toMemberRole(reg.orgRole),
            customRole: targetOrgId === reg.bizPartyId ? "Contact" : undefined,
          },
        });
      }
    }

    // 3 · an individual's own side enterprise — unregistered work done
    // alongside a group/personal registration. The dedicated business
    // path (2b) owns Enterprise creation for a first-class Business.
    if (reg.workRaw && reg.joiningAs !== "biz") {
      await tx.enterprise.create({
        data: {
          partyId: orgPartyId ?? personPartyId,
          workRaw: reg.workRaw,
          segment: reg.segment,
          isRegistered: reg.hasRegisteredBusiness === "yes",
          hasKraPin: reg.hasKraPin === "yes",
        },
      });
    }

    // 4 · hand the documents uploaded during registration over to the
    // real party they belong to. They live on the registration until
    // now — completing it is exactly the point they need to be findable
    // wherever staff actually look for a party's paperwork (the group's
    // own page, not just the registration record it started from).
    await tx.document.updateMany({
      where: { registrationId: id, partyId: null },
      data: { partyId: bizPartyId ?? orgPartyId ?? personPartyId },
    });

    // 5 · close the funnel record. groupPartyId/bizPartyId are written
    // back here even for a brand-new org (orgPartyId/bizPartyId from
    // step 2/2b) — previously only the "joined an existing org via
    // search" path (2c) ever populated these, so a completed
    // registration that founded a new group or business had no durable
    // link back to the Organisation it just created. That gap is
    // exactly what made "which registration made this group" and "is
    // this a group or an individual registration" unanswerable from
    // the registration row alone.
    const done = await tx.registration.update({
      where: { id },
      data: {
        status: "COMPLETE" as RegistrationStatus,
        completedAt: new Date(),
        partyId: personPartyId,
        groupPartyId: orgPartyId ?? reg.groupPartyId,
        bizPartyId: bizPartyId ?? reg.bizPartyId,
      },
    });

    await recordAudit(
      ctx,
      {
        action: "registration.completed",
        targetType: "party",
        targetId: personPartyId,
        payload: {
          registrationId: id,
          joiningAs: reg.joiningAs,
          county: reg.county,
          orgCreated: Boolean(orgPartyId),
          bizCreated: Boolean(bizPartyId),
          reuseExistingPerson,
          createdNewPerson: !reuseExistingPerson,
        },
      },
      tx as never,
    );

    return {
      registration: done,
      partyId: personPartyId,
      orgPartyId,
      bizPartyId,
    };
  });
}

/**
 * One-off repair for registrations completed before completeRegistration
 * started re-parenting documents to the real party (see 4b above) — their
 * documents are still stranded on registrationId alone, invisible to
 * `listDocumentsForParty` and therefore to the group's own page. Safe to
 * re-run: only touches documents with no partyId yet.
 *
 * For a group registration, the founder's earliest active membership is
 * used to find the org — a reliable stand-in for "which org did this
 * registration create" since a person has at most one active group at a
 * time by product rule (see assignPersonToGroup).
 */
export async function backfillRegistrationDocuments(ctx: Ctx) {
  requireCapability(ctx, "registration.write");

  const orphaned = await prisma.document.findMany({
    where: { partyId: null, registrationId: { not: null } },
    select: { id: true, registrationId: true },
  });

  let updated = 0;
  for (const doc of orphaned) {
    const reg = await prisma.registration.findUnique({
      where: { id: doc.registrationId! },
      select: { partyId: true, joiningAs: true },
    });
    if (!reg?.partyId) continue; // never completed — nothing to attach to yet

    let targetPartyId = reg.partyId;
    if (reg.joiningAs === "group") {
      const founding = await prisma.membership.findFirst({
        where: { personId: reg.partyId, exitedAt: null },
        orderBy: { joinedAt: "asc" },
        select: { orgId: true },
      });
      if (founding) targetPartyId = founding.orgId;
    }

    await prisma.document.update({
      where: { id: doc.id },
      data: { partyId: targetPartyId },
    });
    updated += 1;
  }

  await recordAudit(ctx, {
    action: "documents.backfilled_party",
    targetType: "document",
    targetId: "bulk",
    payload: { candidates: orphaned.length, updated },
  });

  return { candidates: orphaned.length, updated };
}

/* ── reads ──────────────────────────────────────────────────── */

export async function getRegistration(ctx: Ctx, id: string) {
  requireCapability(ctx, "registration.read", { registrationId: id });
  return prisma.registration.findUnique({ where: { id } });
}

export interface ListRegistrationsFilter {
  status?: RegistrationStatus;
  county?: string;
  from?: Date;
  to?: Date;
  search?: string;
  /** 'organisations' → joiningAs === 'group'; 'individuals' → anything else. */
  type?: "individuals" | "organisations";
  /** Which front door the registration came through — see
   *  SourceSystem/JoinPath.CECF_WEB. Powers admin's "CECF Registrations"
   *  filter/badge. */
  source?: "CECF" | "ESOKO";
  take?: number;
  skip?: number;
}

export async function listRegistrations(
  ctx: Ctx,
  f: ListRegistrationsFilter = {},
) {
  requireCapability(ctx, "registration.read", { county: f.county });

  const where = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.county ? { county: f.county } : {}),
    // A business is an organisation exactly as much as a group is —
    // both are independent Organisation parties from the person who
    // registered them (see completeRegistration). This used to only
    // match joiningAs:'group', which silently filed every business
    // registration under "Individuals".
    ...(f.type === "organisations"
      ? { joiningAs: { in: ["group", "biz"] } }
      : {}),
    ...(f.type === "individuals" ? { joiningAs: "me" } : {}),
    ...(f.source === "CECF" ? { path: "CECF_WEB" as JoinPath } : {}),
    ...(f.source === "ESOKO" ? { path: { not: "CECF_WEB" as JoinPath } } : {}),
    ...(f.from || f.to
      ? {
          startedAt: {
            ...(f.from ? { gte: f.from } : {}),
            ...(f.to ? { lte: f.to } : {}),
          },
        }
      : {}),
    ...(f.search
      ? {
          OR: [
            {
              officialName: {
                contains: f.search,
                mode: "insensitive" as const,
              },
            },
            { knownAs: { contains: f.search, mode: "insensitive" as const } },
            { orgName: { contains: f.search, mode: "insensitive" as const } },
            { workRaw: { contains: f.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.registration.findMany({
      where,
      orderBy: { startedAt: "desc" },
      take: f.take ?? 25,
      skip: f.skip ?? 0,
      include: {
        // Only ever needed to NAME the org this registration is
        // attached to when it joined one already on file rather than
        // typing a brand-new name (orgName/bizName stay null in that
        // case) — see completeRegistration's step 2c. Without this a
        // "joined an existing group" row has no group name to show at
        // all, which is exactly the "which group is this member from"
        // gap this include closes.
        groupParty: {
          select: { organisation: { select: { officialName: true } } },
        },
        bizParty: {
          select: { organisation: { select: { officialName: true } } },
        },
      },
    }),
    prisma.registration.count({ where }),
  ]);

  return { rows, total };
}

export async function findRegistrationByMsisdn(ctx: Ctx, msisdn: string) {
  requireCapability(ctx, "registration.read");
  return prisma.registration.findFirst({
    where: { msisdn, status: { not: "COMPLETE" } },
    orderBy: { startedAt: "desc" },
  });
}

/* ── admin CRUD ─────────────────────────────────────────────── */

/**
 * Void rather than delete.
 *
 * A hard delete would break the audit chain's reference and destroy the
 * only record that someone's data was ever held — which is the opposite
 * of what a DPA erasure request requires. Voiding removes it from every
 * report and count while keeping the trail.
 */
export async function voidRegistration(ctx: Ctx, id: string, reason: string) {
  requireCapability(ctx, "registration.void", { registrationId: id });
  if (!reason?.trim())
    throw new Error("A reason is required to void a registration");

  const reg = await prisma.registration.update({
    where: { id },
    data: {
      status: "ABANDONED",
      voidedAt: new Date(),
      voidedById: ctx.actorId ?? undefined,
      voidReason: reason.trim(),
    },
  });
  await recordAudit(ctx, {
    action: "registration.voided",
    targetType: "registration",
    targetId: id,
    payload: { reason },
  });
  return reg;
}

export async function restoreRegistration(ctx: Ctx, id: string) {
  requireCapability(ctx, "registration.void", { registrationId: id });
  const reg = await prisma.registration.update({
    where: { id },
    data: {
      status: "STARTED",
      voidedAt: null,
      voidedById: null,
      voidReason: null,
    },
  });
  await recordAudit(ctx, {
    action: "registration.restored",
    targetType: "registration",
    targetId: id,
  });
  return reg;
}

/** Staff-initiated registration — walk-ins, phone calls, agent capture. */
export async function createRegistrationForPerson(
  ctx: Ctx,
  input: UpdateRegistrationInput & { joiningAs: "me" | "group" | "biz" },
) {
  requireCapability(ctx, "registration.create");
  if (!input.officialName?.trim()) {
    throw new Error("A name is required to start a registration");
  }
  const reg = await prisma.registration.create({
    data: {
      ...input,
      path: "AGENT_ASSISTED",
      agentId: ctx.actorId ?? undefined,
      status: "STARTED",
    },
  });
  await recordAudit(ctx, {
    action: "registration.created_by_staff",
    targetType: "registration",
    targetId: reg.id,
    payload: { joiningAs: input.joiningAs },
  });
  return reg;
}

/** Full detail for the admin drawer — registration, payment, documents. */
export async function getRegistrationDetail(ctx: Ctx, id: string) {
  requireCapability(ctx, "registration.read", { registrationId: id });
  const reg = await prisma.registration.findUnique({
    where: { id },
    include: {
      payment: {
        include: {
          approvals: {
            include: {
              approver: { select: { id: true, name: true, email: true } },
            },
            orderBy: { signedAt: "asc" },
          },
        },
      },
      documents: {
        where: { deletedAt: null },
        orderBy: { uploadedAt: "desc" },
      },
      party: {
        include: {
          person: {
            include: {
              credential: { select: { pinHash: true, pinSetAt: true } },
            },
          },
          enterprises: true,
          attestations: true,
          memberships: {
            where: { exitedAt: null },
            include: { org: { select: { officialName: true, knownAs: true } } },
          },
        },
      },
    },
  });
  if (!reg) return null;
  return {
    ...reg,
    payment: reg.payment
      ? {
          ...reg.payment,
          amountKes: reg.payment.amountKes
            ? Number(reg.payment.amountKes)
            : null,
        }
      : null,
    // The raw Argon2id hash never needs to leave the server — a 4-6
    // digit PIN behind it is cheaply offline-crackable if it ever does.
    // Everything the admin UI actually renders is this boolean plus
    // pinSetAt, so that's all this returns.
    party: reg.party && {
      ...reg.party,
      person: reg.party.person && {
        ...reg.party.person,
        credential: {
          hasPinSet: Boolean(reg.party.person.credential?.pinHash),
          pinSetAt: reg.party.person.credential?.pinSetAt ?? null,
        },
      },
    },
  };
}

/** Probable duplicates — the agent-fraud control from the journey maps. */
export async function findProbableDuplicates(ctx: Ctx, take = 25) {
  requireCapability(ctx, "duplicate.review");
  const rows = await prisma.$queryRaw<
    { msisdn: string; n: bigint; ids: string[] }[]
  >`
    SELECT "msisdn", COUNT(*)::bigint AS n, array_agg(id::text) AS ids
    FROM registration
    WHERE "msisdn" IS NOT NULL AND "voidedAt" IS NULL
    GROUP BY "msisdn" HAVING COUNT(*) > 1
    ORDER BY n DESC LIMIT ${take}`;
  return rows.map((r) => ({
    msisdn: r.msisdn,
    count: Number(r.n),
    ids: r.ids,
  }));
}
