import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { SondeDb } from '../db/index.js';
import {
  filterAgentsByAccess,
  filterIntegrationsByAccess,
  getVisibleAgentPatterns,
  getVisibleIntegrationIds,
  isAgentVisible,
  isIntegrationVisible,
} from './access-groups.js';

describe('access groups', () => {
  let db: SondeDb;

  afterEach(() => {
    db?.close();
  });

  function setup() {
    db = new SondeDb(':memory:');
    return db;
  }

  describe('unrestricted user (no access group assignments)', () => {
    it('getVisibleAgentPatterns returns null', () => {
      setup();
      expect(getVisibleAgentPatterns(db, 'user-1')).toBeNull();
    });

    it('getVisibleIntegrationIds returns null', () => {
      setup();
      expect(getVisibleIntegrationIds(db, 'user-1')).toBeNull();
    });

    it('isAgentVisible returns true', () => {
      setup();
      expect(isAgentVisible(db, 'user-1', 'any-agent')).toBe(true);
    });

    it('isIntegrationVisible returns true', () => {
      setup();
      expect(isIntegrationVisible(db, 'user-1', 'any-integration')).toBe(true);
    });

    it('filterAgentsByAccess returns all agents', () => {
      setup();
      const agents = [{ name: 'a1' }, { name: 'a2' }];
      expect(filterAgentsByAccess(db, 'user-1', agents)).toEqual(agents);
    });

    it('filterIntegrationsByAccess returns all integrations', () => {
      setup();
      const integrations = [{ id: 'i1' }, { id: 'i2' }];
      expect(filterIntegrationsByAccess(db, 'user-1', integrations)).toEqual(integrations);
    });
  });

  describe('scoped user (has access group assignments)', () => {
    function setupWithGroups() {
      setup();

      // Create access group
      const groupId = crypto.randomUUID();
      db.createAccessGroup(groupId, 'Desktop Team', 'Desktop support team');

      // Add agent patterns: exact and wildcard
      db.addAccessGroupAgent(groupId, 'desktop-*');
      db.addAccessGroupAgent(groupId, 'citrix-01');

      // Add integrations
      db.addAccessGroupIntegration(groupId, 'int-servicenow');

      // Assign user
      db.addAccessGroupUser(groupId, 'user-scoped');

      return groupId;
    }

    it('getVisibleAgentPatterns returns patterns', () => {
      setupWithGroups();
      const patterns = getVisibleAgentPatterns(db, 'user-scoped');
      expect(patterns).not.toBeNull();
      expect(patterns).toContain('desktop-*');
      expect(patterns).toContain('citrix-01');
    });

    it('getVisibleIntegrationIds returns assigned IDs', () => {
      setupWithGroups();
      const ids = getVisibleIntegrationIds(db, 'user-scoped');
      expect(ids).not.toBeNull();
      expect(ids).toContain('int-servicenow');
    });

    it('isAgentVisible matches exact name', () => {
      setupWithGroups();
      expect(isAgentVisible(db, 'user-scoped', 'citrix-01')).toBe(true);
    });

    it('isAgentVisible matches wildcard pattern', () => {
      setupWithGroups();
      expect(isAgentVisible(db, 'user-scoped', 'desktop-win10-pc')).toBe(true);
    });

    it('isAgentVisible rejects non-matching agent', () => {
      setupWithGroups();
      expect(isAgentVisible(db, 'user-scoped', 'server-prod-01')).toBe(false);
    });

    it('isIntegrationVisible accepts assigned integration', () => {
      setupWithGroups();
      expect(isIntegrationVisible(db, 'user-scoped', 'int-servicenow')).toBe(true);
    });

    it('isIntegrationVisible rejects unassigned integration', () => {
      setupWithGroups();
      expect(isIntegrationVisible(db, 'user-scoped', 'int-other')).toBe(false);
    });

    it('filterAgentsByAccess filters correctly', () => {
      setupWithGroups();
      const agents = [
        { name: 'desktop-win10-pc', id: '1' },
        { name: 'citrix-01', id: '2' },
        { name: 'server-prod-01', id: '3' },
        { name: 'desktop-mac-laptop', id: '4' },
      ];
      const filtered = filterAgentsByAccess(db, 'user-scoped', agents);
      expect(filtered).toHaveLength(3);
      expect(filtered.map((a) => a.name)).toEqual([
        'desktop-win10-pc',
        'citrix-01',
        'desktop-mac-laptop',
      ]);
    });

    it('filterIntegrationsByAccess filters correctly', () => {
      setupWithGroups();
      const integrations = [
        { id: 'int-servicenow', name: 'ServiceNow' },
        { id: 'int-other', name: 'Other' },
      ];
      const filtered = filterIntegrationsByAccess(db, 'user-scoped', integrations);
      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.id).toBe('int-servicenow');
    });
  });

  describe('multiple access groups', () => {
    it('combines patterns from all assigned groups', () => {
      setup();

      const group1 = crypto.randomUUID();
      db.createAccessGroup(group1, 'Group A', '');
      db.addAccessGroupAgent(group1, 'desktop-*');
      db.addAccessGroupUser(group1, 'user-multi');

      const group2 = crypto.randomUUID();
      db.createAccessGroup(group2, 'Group B', '');
      db.addAccessGroupAgent(group2, 'server-*');
      db.addAccessGroupUser(group2, 'user-multi');

      expect(isAgentVisible(db, 'user-multi', 'desktop-01')).toBe(true);
      expect(isAgentVisible(db, 'user-multi', 'server-01')).toBe(true);
      expect(isAgentVisible(db, 'user-multi', 'other-01')).toBe(false);
    });
  });
});
