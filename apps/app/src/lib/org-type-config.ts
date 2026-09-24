/**
 * Organization type configuration for the frontend.
 *
 * This file defines how each organization type should be displayed, navigated,
 * and entered in the workspace switcher and portal system. It's the single source
 * of truth for org type metadata on the frontend, allowing new org types to be
 * added without modifying component logic.
 */

export type OrgTypeId =
  | 'personal'
  | 'courier'
  | 'ticket'
  | 'hotel'
  | 'eatery'
  | 'chama'
  | 'tout';

export type WorkspaceKind = 'personal' | 'managed';
export type EntryType = 'direct' | 'session' | 'custom';
export type SessionProfile = 'shift' | 'session' | 'readonly';

/**
 * Configuration for a single organization type.
 */
export interface OrgTypeConfig {
  /** Unique identifier */
  id: OrgTypeId;

  /** Human-readable display name */
  label: string;

  /** Category for grouping in UI (logistics, hospitality, food, social, etc.) */
  category: string;

  /** Description of what this org type does */
  description: string;

  /** Workspace kind (personal or managed) */
  kind: WorkspaceKind;

  /** Sort order in workspace lists (lower = higher priority) */
  order: number;

  /** How to enter this workspace (direct link, session minting, or custom) */
  entryType: EntryType;

  /** Session profile (affects TTL and security) */
  sessionProfile: SessionProfile;

  /** Portal route for this org type */
  portalRoute: string; // e.g., '/org/courier', '/org/hotel'

  /** Whether new staff need to be approved by org admin */
  requiresApproval: boolean;

  /** Whether this org type supports multi-user access */
  supportsTeam: boolean;

  /** Whether walk-in customers/guests are supported */
  supportsWalkIn: boolean;

  /** Whether this org type supports inventory/stock management */
  supportsInventory: boolean;

  /** Whether this org type supports reporting/analytics */
  supportsReporting: boolean;

  /** Icon name for display */
  icon: string;

  /** Brand color for UI theming (hex) */
  brandColor?: string;
}

/**
 * Complete registry of all organization types.
 * Add new org types here to make them available system-wide.
 */
export const ORG_TYPE_CONFIG: Record<OrgTypeId, OrgTypeConfig> = {
  personal: {
    id: 'personal',
    label: 'Personal Account',
    category: 'personal',
    description: 'Your own record and personal workspace',
    kind: 'personal',
    order: 0,
    entryType: 'direct',
    sessionProfile: 'session',
    portalRoute: '/me',
    requiresApproval: false,
    supportsTeam: false,
    supportsWalkIn: false,
    supportsInventory: false,
    supportsReporting: true,
    icon: 'user',
    brandColor: '#1f2937',
  },
  courier: {
    id: 'courier',
    label: 'Courier Company',
    category: 'logistics',
    description: 'Delivery and logistics operations',
    kind: 'managed',
    order: 1,
    entryType: 'session',
    sessionProfile: 'shift',
    portalRoute: '/org/courier',
    requiresApproval: true,
    supportsTeam: true,
    supportsWalkIn: true,
    supportsInventory: true,
    supportsReporting: true,
    icon: 'truck',
    brandColor: '#dc2626',
  },
  ticket: {
    id: 'ticket',
    label: 'Event/Transport Organiser',
    category: 'managed',
    description: 'Ticket sales and event management',
    kind: 'managed',
    order: 2,
    entryType: 'direct',
    sessionProfile: 'session',
    portalRoute: '/org/ticket',
    requiresApproval: true,
    supportsTeam: true,
    supportsWalkIn: false,
    supportsInventory: false,
    supportsReporting: true,
    icon: 'ticket',
    brandColor: '#2563eb',
  },
  hotel: {
    id: 'hotel',
    label: 'Hotel',
    category: 'hospitality',
    description: 'Hotel and accommodation management',
    kind: 'managed',
    order: 3,
    entryType: 'session',
    sessionProfile: 'session',
    portalRoute: '/org/hotel',
    requiresApproval: true,
    supportsTeam: true,
    supportsWalkIn: false,
    supportsInventory: true,
    supportsReporting: true,
    icon: 'building-2',
    brandColor: '#7c3aed',
  },
  eatery: {
    id: 'eatery',
    label: 'Restaurant/Eatery',
    category: 'food',
    description: 'Food and beverage operations',
    kind: 'managed',
    order: 4,
    entryType: 'session',
    sessionProfile: 'shift',
    portalRoute: '/org/eatery',
    requiresApproval: true,
    supportsTeam: true,
    supportsWalkIn: true,
    supportsInventory: true,
    supportsReporting: true,
    icon: 'utensils',
    brandColor: '#f59e0b',
  },
  chama: {
    id: 'chama',
    label: 'Chama/Savings Group',
    category: 'social',
    description: 'Community savings and investment group',
    kind: 'managed',
    order: 5,
    entryType: 'session',
    sessionProfile: 'session',
    portalRoute: '/org/chama',
    requiresApproval: false,
    supportsTeam: true,
    supportsWalkIn: false,
    supportsInventory: false,
    supportsReporting: true,
    icon: 'users',
    brandColor: '#10b981',
  },
  tout: {
    id: 'tout',
    label: 'Tout/Broker',
    category: 'logistics',
    description: 'Transportation broker or agent',
    kind: 'managed',
    order: 6,
    entryType: 'session',
    sessionProfile: 'session',
    portalRoute: '/org/tout',
    requiresApproval: false,
    supportsTeam: true,
    supportsWalkIn: true,
    supportsInventory: false,
    supportsReporting: true,
    icon: 'briefcase',
    brandColor: '#06b6d4',
  },
};

/**
 * Get configuration for an organization type.
 */
export function getOrgTypeConfig(orgType: string): OrgTypeConfig | undefined {
  return ORG_TYPE_CONFIG[orgType as OrgTypeId];
}

/**
 * Get all org types in a specific category.
 */
export function getOrgTypesByCategory(category: string): OrgTypeConfig[] {
  return Object.values(ORG_TYPE_CONFIG)
    .filter((cfg) => cfg.category === category)
    .sort((a, b) => a.order - b.order);
}

/**
 * Get all org types sorted by order.
 */
export function getAllOrgTypes(): OrgTypeConfig[] {
  return Object.values(ORG_TYPE_CONFIG).sort((a, b) => a.order - b.order);
}

/**
 * Get all managed org types (not personal).
 */
export function getManagedOrgTypes(): OrgTypeConfig[] {
  return getAllOrgTypes().filter((cfg) => cfg.kind === 'managed');
}

/**
 * Get all unique categories.
 */
export function getAllCategories(): string[] {
  const categories = new Set(
    Object.values(ORG_TYPE_CONFIG).map((cfg) => cfg.category)
  );
  return Array.from(categories);
}

/**
 * Group org types by category for UI display.
 */
export interface OrgTypeGroup {
  categoryId: string;
  categoryLabel: string;
  types: OrgTypeConfig[];
}

export function groupOrgTypesByCategory(): OrgTypeGroup[] {
  const categoryLabels: Record<string, string> = {
    personal: 'Personal',
    logistics: 'Logistics & Transport',
    hospitality: 'Hospitality',
    food: 'Food & Beverage',
    social: 'Social & Community',
    managed: 'Organizations',
  };

  const groups = new Map<string, OrgTypeConfig[]>();

  // Group org types by category
  for (const config of Object.values(ORG_TYPE_CONFIG)) {
    if (!groups.has(config.category)) {
      groups.set(config.category, []);
    }
    groups.get(config.category)!.push(config);
  }

  // Sort types within each group and build result
  const result: OrgTypeGroup[] = [];
  for (const [categoryId, types] of groups.entries()) {
    result.push({
      categoryId,
      categoryLabel: categoryLabels[categoryId] || categoryId,
      types: types.sort((a, b) => a.order - b.order),
    });
  }

  // Sort groups by the order of the first type in each group
  result.sort((a, b) => {
    const minOrderA = Math.min(...a.types.map((t) => t.order));
    const minOrderB = Math.min(...b.types.map((t) => t.order));
    return minOrderA - minOrderB;
  });

  return result;
}
