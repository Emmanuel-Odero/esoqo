-- Custom-role permissions for courier-company staff.
--
-- A parcel_org_staff row with a preset role resolves its capability
-- bundle from the role name at sign-in. A custom ("Other…") role has no
-- preset to resolve, and previously floored at RIDER. This column
-- carries an explicit, sanitized-permission set (authsvc.
-- AllParcelOrgCapabilities) that replaces the role bundle when present,
-- so an owner can grant exactly the access a free-text title needs.
-- Empty means "derive from role", same as every row did before.
ALTER TABLE "parcel_org_staff"
  ADD COLUMN "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
