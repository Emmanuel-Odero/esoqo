import { prisma } from '../client';
import { requireCapability, ROLE_PRESETS, ALL_CAPABILITIES,
         type Capability, type Ctx, type RoleName } from '../capabilities';
import { recordAudit } from '../audit';

/**
 * Staff and permissions.
 *
 * Roles are presets of capabilities, not a separate model. The super
 * admin can hand-tune any account's capability list — which is the whole
 * reason the CECF platform's nine hardcoded roles were replaced.
 */

export async function listStaff(ctx: Ctx) {
  requireCapability(ctx, 'staff.read');
  return prisma.staffUser.findMany({
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    select: {
      id: true, email: true, name: true, rolePreset: true, capabilities: true,
      countyScope: true, active: true, suspendedAt: true, lastSeenAt: true,
      mustChangePin: true, createdAt: true,
      _count: { select: { approvals: true } },
    },
  });
}

export async function getStaff(ctx: Ctx, id: string) {
  requireCapability(ctx, 'staff.read');
  return prisma.staffUser.findUnique({
    where: { id },
    select: {
      id: true, email: true, name: true, rolePreset: true, capabilities: true,
      countyScope: true, active: true, suspendedAt: true, lastSeenAt: true, createdAt: true,
      approvals: {
        take: 20, orderBy: { signedAt: 'desc' },
        select: { id: true, decision: true, signedAt: true, paymentId: true },
      },
    },
  });
}

export interface CreateStaffInput {
  email: string;
  name: string;
  rolePreset: RoleName;
  countyScope?: string[];
  pinHash: string;
}

export async function createStaff(ctx: Ctx, input: CreateStaffInput) {
  requireCapability(ctx, 'staff.write');
  const caps = [...ROLE_PRESETS[input.rolePreset]] as Capability[];

  const staff = await prisma.staffUser.create({
    data: {
      email: input.email.toLowerCase().trim(),
      name: input.name.trim(),
      rolePreset: input.rolePreset,
      capabilities: caps,
      countyScope: input.countyScope ?? [],
      pinHash: input.pinHash,
      invitedById: ctx.actorId ?? undefined,
      mustChangePin: true,
    },
  });

  await recordAudit(ctx, {
    action: 'staff.created', targetType: 'staff', targetId: staff.id,
    payload: { rolePreset: input.rolePreset, capabilities: caps.length },
  });
  return staff;
}

/**
 * Grant or revoke capabilities directly.
 *
 * Guardrails, deliberately: you cannot grant a capability you do not
 * hold yourself, and you cannot edit your own capabilities. Both are
 * privilege-escalation routes if left open.
 */
export async function setCapabilities(ctx: Ctx, staffId: string, capabilities: Capability[]) {
  requireCapability(ctx, 'staff.capabilities');

  if (staffId === ctx.actorId) {
    throw new Error('You cannot change your own permissions. Ask another administrator.');
  }

  const isSuper = ctx.capabilities.includes('*');
  const invalid = capabilities.filter((c) => !ALL_CAPABILITIES.includes(c));
  if (invalid.length) throw new Error(`Unknown capability: ${invalid[0]}`);

  if (!isSuper) {
    const cannotGrant = capabilities.filter((c) => !ctx.capabilities.includes(c));
    if (cannotGrant.length) {
      throw new Error(`You cannot grant ${cannotGrant[0]} because you do not hold it yourself.`);
    }
  }

  const before = await prisma.staffUser.findUnique({
    where: { id: staffId }, select: { capabilities: true },
  });

  const staff = await prisma.staffUser.update({
    where: { id: staffId },
    data: { capabilities, rolePreset: 'CUSTOM' },
  });

  const added = capabilities.filter((c) => !before?.capabilities.includes(c));
  const removed = (before?.capabilities ?? []).filter((c) => !capabilities.includes(c));

  await recordAudit(ctx, {
    action: 'staff.capabilities_changed', targetType: 'staff', targetId: staffId,
    payload: { added, removed },
  });
  return staff;
}

export async function applyRolePreset(ctx: Ctx, staffId: string, preset: RoleName) {
  requireCapability(ctx, 'staff.capabilities');
  if (staffId === ctx.actorId) throw new Error('You cannot change your own role.');
  const caps = [...ROLE_PRESETS[preset]] as Capability[];
  const staff = await prisma.staffUser.update({
    where: { id: staffId }, data: { capabilities: caps, rolePreset: preset },
  });
  await recordAudit(ctx, {
    action: 'staff.role_applied', targetType: 'staff', targetId: staffId, payload: { preset },
  });
  return staff;
}

export async function setStaffActive(ctx: Ctx, staffId: string, active: boolean, reason?: string) {
  requireCapability(ctx, 'staff.write');
  if (staffId === ctx.actorId) throw new Error('You cannot suspend your own account.');
  const staff = await prisma.staffUser.update({
    where: { id: staffId },
    data: { active, suspendedAt: active ? null : new Date() },
  });
  await recordAudit(ctx, {
    action: active ? 'staff.reinstated' : 'staff.suspended',
    targetType: 'staff', targetId: staffId, payload: { reason },
  });
  return staff;
}

/** Who may sign payment approvals. Rendered on the payments page so the
 *  approval requirement is never a mystery. */
export async function listApprovers(ctx: Ctx) {
  requireCapability(ctx, 'payment.read');
  const all = await prisma.staffUser.findMany({
    where: { active: true },
    select: { id: true, name: true, email: true, capabilities: true },
  });
  return all.filter((s) => s.capabilities.includes('payment.approve') || s.capabilities.includes('*'));
}
