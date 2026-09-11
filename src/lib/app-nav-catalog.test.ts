import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  APP_NAV_GROUPS,
  APP_NAV_PROFILE_LINK,
  APP_NAV_SCENE_ALIASES,
  APP_NAV_SETTINGS_LINK,
  flattenAppNavLinks,
  mergePluginLinksIntoNav,
  type AppNavGroup,
  type AppNavLink,
} from './app-nav-catalog';

function allHrefs(groups: AppNavGroup[]): string[] {
  return groups.flatMap(group => group.links.map(link => link.href));
}

function assertValidLink(link: AppNavLink) {
  assert.ok(link.href.startsWith('/'), `href should start with / — got ${link.href}`);
  assert.ok(link.label.trim().length > 0, `label should be non-empty for ${link.href}`);
  assert.ok(link.description.trim().length > 0, `description should be non-empty for ${link.href}`);
}

describe('app-nav-catalog', () => {
  describe('APP_NAV_GROUPS', () => {
    it('declares the seven top-level groups in a stable order', () => {
      assert.deepEqual(
        APP_NAV_GROUPS.map(group => group.label),
        ['Overview', 'Prompt', 'Scene', 'Edit', 'Media', 'Library', 'Extras']
      );
    });

    it('gives every group a non-empty label and a non-empty links array', () => {
      for (const group of APP_NAV_GROUPS) {
        assert.ok(group.label.trim().length > 0);
        assert.ok(Array.isArray(group.links));
        assert.ok(group.links.length > 0, `group ${group.label} should have links`);
      }
    });

    it('gives every link a valid href/label/description shape', () => {
      for (const group of APP_NAV_GROUPS) {
        for (const link of group.links) {
          assertValidLink(link);
        }
      }
    });

    it('has no duplicate hrefs across the whole catalog', () => {
      const hrefs = allHrefs(APP_NAV_GROUPS);
      assert.equal(new Set(hrefs).size, hrefs.length);
    });

    it('includes the expected core routes in their documented groups', () => {
      const overview = APP_NAV_GROUPS.find(group => group.label === 'Overview')!;
      const library = APP_NAV_GROUPS.find(group => group.label === 'Library')!;
      assert.ok(overview.links.some(link => link.href === '/dashboard'));
      assert.ok(overview.links.some(link => link.href === '/queue'));
      assert.ok(library.links.some(link => link.href === '/gallery'));
      assert.ok(library.links.some(link => link.href === '/plugins'));
    });
  });

  describe('APP_NAV_SETTINGS_LINK / APP_NAV_PROFILE_LINK', () => {
    it('APP_NAV_SETTINGS_LINK points at /settings and is a valid link', () => {
      assert.equal(APP_NAV_SETTINGS_LINK.href, '/settings');
      assert.equal(APP_NAV_SETTINGS_LINK.label, 'Settings');
      assertValidLink(APP_NAV_SETTINGS_LINK);
    });

    it('APP_NAV_PROFILE_LINK points at /profile and is a valid link', () => {
      assert.equal(APP_NAV_PROFILE_LINK.href, '/profile');
      assert.equal(APP_NAV_PROFILE_LINK.label, 'Profile');
      assertValidLink(APP_NAV_PROFILE_LINK);
    });

    it('neither settings nor profile hrefs are duplicated inside APP_NAV_GROUPS', () => {
      const hrefs = new Set(allHrefs(APP_NAV_GROUPS));
      assert.equal(hrefs.has(APP_NAV_SETTINGS_LINK.href), false);
      assert.equal(hrefs.has(APP_NAV_PROFILE_LINK.href), false);
    });
  });

  describe('APP_NAV_SCENE_ALIASES', () => {
    it('lists the three legacy scene routes with valid link shapes', () => {
      assert.deepEqual(
        APP_NAV_SCENE_ALIASES.map(alias => alias.href),
        ['/background', '/pet', '/fantasy']
      );
      for (const alias of APP_NAV_SCENE_ALIASES) {
        assertValidLink(alias);
      }
    });

    it('none of the alias base paths already exist in APP_NAV_GROUPS', () => {
      const hrefs = new Set(allHrefs(APP_NAV_GROUPS));
      for (const alias of APP_NAV_SCENE_ALIASES) {
        assert.equal(hrefs.has(alias.href), false);
      }
    });
  });

  describe('flattenAppNavLinks', () => {
    it('flattens the default groups in order, without scene aliases by default', () => {
      const expected = APP_NAV_GROUPS.flatMap(group => group.links);
      const flat = flattenAppNavLinks();
      assert.deepEqual(flat, expected);
      const aliasHrefs = new Set(APP_NAV_SCENE_ALIASES.map(alias => alias.href));
      assert.ok(flat.every(link => !aliasHrefs.has(link.href)));
    });

    it('an explicit options object without includeSceneAliases behaves like no options', () => {
      const flat = flattenAppNavLinks(APP_NAV_GROUPS, {});
      assert.equal(flat.length, APP_NAV_GROUPS.flatMap(group => group.links).length);
    });

    it('appends every scene alias when includeSceneAliases is true and none conflict', () => {
      const base = APP_NAV_GROUPS.flatMap(group => group.links);
      const flat = flattenAppNavLinks(APP_NAV_GROUPS, { includeSceneAliases: true });
      assert.equal(flat.length, base.length + APP_NAV_SCENE_ALIASES.length);
      assert.deepEqual(flat.slice(base.length), APP_NAV_SCENE_ALIASES);
    });

    it('skips an alias whose path (query ignored) is already present in the given groups', () => {
      const customGroups: AppNavGroup[] = [
        {
          label: 'Custom',
          links: [{ href: '/pet?ref=nav', label: 'Pet (custom)', description: 'already covers pet' }],
        },
      ];
      const flat = flattenAppNavLinks(customGroups, { includeSceneAliases: true });
      // Only the custom /pet link, plus the two non-conflicting aliases (background, fantasy).
      assert.equal(flat.length, 3);
      assert.equal(flat[0]!.href, '/pet?ref=nav');
      const remainingHrefs = flat.slice(1).map(link => link.href);
      assert.deepEqual(remainingHrefs.sort(), ['/background', '/fantasy']);
    });

    it('accepts a custom groups array in place of APP_NAV_GROUPS', () => {
      const customGroups: AppNavGroup[] = [
        { label: 'A', links: [{ href: '/a', label: 'A', description: 'a' }] },
        { label: 'B', links: [{ href: '/b', label: 'B', description: 'b' }] },
      ];
      assert.deepEqual(flattenAppNavLinks(customGroups), [
        { href: '/a', label: 'A', description: 'a' },
        { href: '/b', label: 'B', description: 'b' },
      ]);
    });

    it('does not mutate APP_NAV_GROUPS or leak aliases into a later call', () => {
      flattenAppNavLinks(APP_NAV_GROUPS, { includeSceneAliases: true });
      flattenAppNavLinks(APP_NAV_GROUPS, { includeSceneAliases: true });
      const flatAgain = flattenAppNavLinks();
      assert.equal(flatAgain.length, APP_NAV_GROUPS.flatMap(group => group.links).length);
      const aliasHrefs = new Set(APP_NAV_SCENE_ALIASES.map(alias => alias.href));
      assert.ok(flatAgain.every(link => !aliasHrefs.has(link.href)));
    });
  });

  describe('mergePluginLinksIntoNav', () => {
    it('returns the exact same groups reference when given no plugin links', () => {
      const result = mergePluginLinksIntoNav(APP_NAV_GROUPS, []);
      assert.equal(result, APP_NAV_GROUPS);
    });

    it('appends unique plugin links to the Library group and leaves other groups untouched', () => {
      const plugin: AppNavLink = { href: '/plugin-one', label: 'Plugin One', description: 'p1' };
      const result = mergePluginLinksIntoNav(APP_NAV_GROUPS, [plugin]);
      assert.notEqual(result, APP_NAV_GROUPS);
      const library = result.find(group => group.label === 'Library')!;
      const originalLibrary = APP_NAV_GROUPS.find(group => group.label === 'Library')!;
      assert.equal(library.links.length, originalLibrary.links.length + 1);
      assert.deepEqual(library.links[library.links.length - 1], plugin);
      for (const group of result) {
        if (group.label === 'Library') continue;
        const original = APP_NAV_GROUPS.find(g => g.label === group.label);
        assert.equal(group, original, `non-Library group ${group.label} should be unchanged`);
      }
    });

    it('filters out plugin links whose path already exists in the catalog, ignoring the query string', () => {
      const dup: AppNavLink = { href: '/gallery?ref=plugin', label: 'Gallery dup', description: 'x' };
      const fresh: AppNavLink = { href: '/plugin-fresh', label: 'Fresh', description: 'y' };
      const result = mergePluginLinksIntoNav(APP_NAV_GROUPS, [dup, fresh]);
      const library = result.find(group => group.label === 'Library')!;
      assert.ok(!library.links.some(link => link.href === dup.href));
      assert.ok(library.links.some(link => link.href === fresh.href));
    });

    it('keeps only the first of two plugin links that share the same path', () => {
      const first: AppNavLink = { href: '/plugin-x', label: 'First', description: 'first' };
      const second: AppNavLink = { href: '/plugin-x?variant=2', label: 'Second', description: 'second' };
      const result = mergePluginLinksIntoNav(APP_NAV_GROUPS, [first, second]);
      const library = result.find(group => group.label === 'Library')!;
      const matches = library.links.filter(link => link.href.split('?')[0] === '/plugin-x');
      assert.equal(matches.length, 1);
      assert.deepEqual(matches[0], first);
    });

    it('returns the original groups reference when every plugin link is filtered out as a duplicate', () => {
      const dup: AppNavLink = { href: '/gallery', label: 'Gallery dup', description: 'x' };
      const result = mergePluginLinksIntoNav(APP_NAV_GROUPS, [dup]);
      assert.equal(result, APP_NAV_GROUPS);
    });

    it('merges into a group labeled "Tools" the same way as "Library"', () => {
      const customGroups: AppNavGroup[] = [
        { label: 'Tools', links: [{ href: '/existing', label: 'Existing', description: 'e' }] },
      ];
      const plugin: AppNavLink = { href: '/plugin-tool', label: 'Plugin Tool', description: 'pt' };
      const result = mergePluginLinksIntoNav(customGroups, [plugin]);
      assert.equal(result.length, 1);
      assert.equal(result[0]!.label, 'Tools');
      assert.deepEqual(result[0]!.links, [customGroups[0]!.links[0], plugin]);
    });

    it('merges into both "Library" and "Tools" when both groups are present', () => {
      const customGroups: AppNavGroup[] = [
        { label: 'Library', links: [{ href: '/lib', label: 'Lib', description: 'l' }] },
        { label: 'Tools', links: [{ href: '/tool', label: 'Tool', description: 't' }] },
      ];
      const plugin: AppNavLink = { href: '/plugin-both', label: 'Plugin Both', description: 'pb' };
      const result = mergePluginLinksIntoNav(customGroups, [plugin]);
      assert.equal(result.find(g => g.label === 'Library')!.links.length, 2);
      assert.equal(result.find(g => g.label === 'Tools')!.links.length, 2);
    });

    it('appends a new trailing "Plugins" group when neither Library nor Tools exists', () => {
      const customGroups: AppNavGroup[] = [
        { label: 'Overview', links: [{ href: '/o', label: 'O', description: 'o' }] },
      ];
      const plugin: AppNavLink = { href: '/plugin-new', label: 'New', description: 'n' };
      const result = mergePluginLinksIntoNav(customGroups, [plugin]);
      assert.equal(result.length, 2);
      assert.equal(result[0], customGroups[0]);
      assert.deepEqual(result[1], { label: 'Plugins', links: [plugin] });
    });

    it('defaults to APP_NAV_GROUPS when no groups argument is given', () => {
      const plugin: AppNavLink = { href: '/plugin-default', label: 'Default', description: 'd' };
      const result = mergePluginLinksIntoNav(undefined, [plugin]);
      const library = result.find(group => group.label === 'Library')!;
      assert.ok(library.links.some(link => link.href === plugin.href));
    });
  });
});
