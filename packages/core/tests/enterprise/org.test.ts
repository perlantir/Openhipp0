import { describe, it, expect } from 'vitest';
import { OrgService, roleAtLeast, type OrgStore, type Role } from '../../src/enterprise/org.js';

function fakeStore(): OrgStore {
  const orgs = new Map<string, { id: string; name: string; slug: string; createdAt: string; ownerUserId: string }>();
  const projects = new Map<string, { id: string; organizationId: string; name: string; slug: string; createdAt: string }>();
  const memberships = new Map<string, { userId: string; organizationId: string; role: Role; joinedAt: string }>();
  const key = (u: string, o: string) => `${u}:${o}`;
  let idCounter = 0;
  const nextId = () => `id-${++idCounter}`;
  return {
    async createOrganization(input) {
      const org = { ...input, id: nextId(), createdAt: new Date(0).toISOString() };
      orgs.set(org.id, org);
      return org;
    },
    async getOrganization(id) {
      return orgs.get(id) ?? null;
    },
    async listOrganizationsForUser(userId) {
      const ids = [...memberships.values()].filter((m) => m.userId === userId).map((m) => m.organizationId);
      return ids.map((id) => orgs.get(id)!).filter(Boolean);
    },
    async createProject(input) {
      const p = { ...input, id: nextId(), createdAt: new Date(0).toISOString() };
      projects.set(p.id, p);
      return p;
    },
    async listProjects(orgId) {
      return [...projects.values()].filter((p) => p.organizationId === orgId);
    },
    async addMembership(m) {
      const full = { ...m, joinedAt: new Date(0).toISOString() };
      memberships.set(key(m.userId, m.organizationId), full);
      return full;
    },
    async removeMembership(userId, orgId) {
      memberships.delete(key(userId, orgId));
    },
    async listMemberships(orgId) {
      return [...memberships.values()].filter((m) => m.organizationId === orgId);
    },
    async setRole(userId, orgId, role) {
      const m = memberships.get(key(userId, orgId));
      if (!m) throw new Error('not member');
      m.role = role;
    },
    async getMembership(userId, orgId) {
      return memberships.get(key(userId, orgId)) ?? null;
    },
  };
}

describe('roleAtLeast', () => {
  it('owner outranks all others', () => {
    expect(roleAtLeast('owner', 'admin')).toBe(true);
    expect(roleAtLeast('owner', 'viewer')).toBe(true);
  });
  it('viewer does not outrank member', () => {
    expect(roleAtLeast('viewer', 'member')).toBe(false);
  });
});

describe('OrgService', () => {
  it('creates an org with the creator as owner', async () => {
    const svc = new OrgService(fakeStore());
    const org = await svc.createOrgWithOwner({ name: 'Acme', slug: 'acme', ownerUserId: 'u1' });
    expect(await svc.getRole('u1', org.id)).toBe('owner');
  });

  it('invite requires admin+; member cannot invite', async () => {
    const svc = new OrgService(fakeStore());
    const org = await svc.createOrgWithOwner({ name: 'A', slug: 'a', ownerUserId: 'owner' });
    await svc.inviteUser('owner', org.id, 'member-user', 'member');
    await expect(svc.inviteUser('member-user', org.id, 'newby')).rejects.toThrow(/ROLE_DENIED/);
  });

  it('admin cannot promote to owner; owner can', async () => {
    const svc = new OrgService(fakeStore());
    const org = await svc.createOrgWithOwner({ name: 'A', slug: 'a', ownerUserId: 'o1' });
    await svc.inviteUser('o1', org.id, 'a1', 'admin');
    await svc.inviteUser('o1', org.id, 'm1', 'member');
    await expect(svc.promote('a1', org.id, 'm1', 'owner')).rejects.toThrow(/ROLE_DENIED/);
    await svc.promote('o1', org.id, 'm1', 'owner');
    expect(await svc.getRole('m1', org.id)).toBe('owner');
  });

  it('cannot remove the last owner', async () => {
    const svc = new OrgService(fakeStore());
    const org = await svc.createOrgWithOwner({ name: 'A', slug: 'a', ownerUserId: 'o1' });
    await expect(svc.removeMember('o1', org.id, 'o1')).rejects.toThrow(/LAST_OWNER/);
  });

  it('requireRole throws when user is not a member', async () => {
    const svc = new OrgService(fakeStore());
    const org = await svc.createOrgWithOwner({ name: 'A', slug: 'a', ownerUserId: 'o1' });
    await expect(svc.requireRole('stranger', org.id, 'viewer')).rejects.toThrow(/NOT_MEMBER/);
  });
});
