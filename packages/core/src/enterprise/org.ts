/**
 * Organization + team + membership model.
 *
 * Roles form a strict hierarchy: owner > admin > member > viewer. Every
 * permission check either requires an exact role or "at-least" a role.
 * Organizations contain projects (one-to-many); memberships are (user,
 * organization) pairs with a role. Projects inherit access but can grant
 * additional per-project roles later (Phase 14.3).
 */

export const ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { owner: 4, admin: 3, member: 2, viewer: 1 };

export function roleAtLeast(actual: Role, required: Role): boolean {
  return RANK[actual] >= RANK[required];
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  /** Primary owner id; org must always retain at least one owner. */
  ownerUserId: string;
}

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface Membership {
  userId: string;
  organizationId: string;
  role: Role;
  joinedAt: string;
}

export interface OrgStore {
  createOrganization(input: Omit<Organization, 'id' | 'createdAt'>): Promise<Organization>;
  getOrganization(id: string): Promise<Organization | null>;
  listOrganizationsForUser(userId: string): Promise<readonly Organization[]>;

  createProject(input: Omit<Project, 'id' | 'createdAt'>): Promise<Project>;
  listProjects(orgId: string): Promise<readonly Project[]>;

  addMembership(m: Omit<Membership, 'joinedAt'>): Promise<Membership>;
  removeMembership(userId: string, orgId: string): Promise<void>;
  listMemberships(orgId: string): Promise<readonly Membership[]>;
  setRole(userId: string, orgId: string, role: Role): Promise<void>;
  getMembership(userId: string, orgId: string): Promise<Membership | null>;
}

export class OrgService {
  constructor(private readonly store: OrgStore) {}

  async createOrgWithOwner(input: {
    name: string;
    slug: string;
    ownerUserId: string;
  }): Promise<Organization> {
    const org = await this.store.createOrganization({
      name: input.name,
      slug: input.slug,
      ownerUserId: input.ownerUserId,
    });
    await this.store.addMembership({
      userId: input.ownerUserId,
      organizationId: org.id,
      role: 'owner',
    });
    return org;
  }

  async inviteUser(
    actorId: string,
    orgId: string,
    newUserId: string,
    role: Role = 'member',
  ): Promise<Membership> {
    await this.requireRole(actorId, orgId, 'admin');
    return this.store.addMembership({ userId: newUserId, organizationId: orgId, role });
  }

  async promote(actorId: string, orgId: string, targetUserId: string, role: Role): Promise<void> {
    await this.requireRole(actorId, orgId, 'admin');
    const actorRole = await this.getRole(actorId, orgId);
    const targetRole = await this.getRole(targetUserId, orgId);
    if (!actorRole || !targetRole) throw new Error('ORG_MEMBERSHIP_MISSING');
    // Only owners can grant owner; admins cannot promote to a role >= their own.
    if (role === 'owner' && actorRole !== 'owner') throw new Error('ORG_ROLE_DENIED');
    if (RANK[role] >= RANK[actorRole] && actorRole !== 'owner') {
      throw new Error('ORG_ROLE_DENIED');
    }
    await this.store.setRole(targetUserId, orgId, role);
  }

  async removeMember(actorId: string, orgId: string, targetUserId: string): Promise<void> {
    await this.requireRole(actorId, orgId, 'admin');
    const targetRole = await this.getRole(targetUserId, orgId);
    if (targetRole === 'owner') {
      const mems = await this.store.listMemberships(orgId);
      const owners = mems.filter((m) => m.role === 'owner');
      if (owners.length <= 1) throw new Error('ORG_LAST_OWNER');
    }
    await this.store.removeMembership(targetUserId, orgId);
  }

  async getRole(userId: string, orgId: string): Promise<Role | null> {
    const m = await this.store.getMembership(userId, orgId);
    return m ? m.role : null;
  }

  async requireRole(userId: string, orgId: string, required: Role): Promise<void> {
    const role = await this.getRole(userId, orgId);
    if (!role) throw new Error('ORG_NOT_MEMBER');
    if (!roleAtLeast(role, required)) throw new Error('ORG_ROLE_DENIED');
  }
}
