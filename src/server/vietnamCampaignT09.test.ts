import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { auditAllUnits } from '../../scripts/audit-glb-assets.mts';
import {
  CAMPAIGN_MISSING_GLB_ENTRIES,
  CAMPAIGN_READY_GLB_ENTRIES,
  CAMPAIGN_UNIT_ASSET_MANIFEST,
  GlbLodMetadata,
  resolveCampaignUnitVisual,
  selectVisualLodForZoom,
} from '../content/campaignAssetManifest';

describe('T09 — Military Visual Overhaul: 36-GLB Audit, Manifest, Research-Tier Upgrade & Bundle Integrity', () => {
  const repoRoot = process.cwd();
  const unitsRoot = path.join(repoRoot, 'public/assets/units');

  it('audits all 36 GLB files on disk for valid glTF 2.0 binary structure, grounded pivot, centered XZ, textures, and strict LOD reduction', () => {
    const items = auditAllUnits(unitsRoot);
    assert.equal(items.length, 36, 'Must audit exactly 36 GLB files (12 unit families x 3 LODs)');

    for (const item of items) {
      assert.equal(item.glbVersion, 2, `${item.relativePath} must be glTF 2.0`);
      assert.equal(item.issues.length, 0, `${item.relativePath} has audit issues: ${item.issues.join('; ')}`);
      assert.equal(item.groundedOk, true, `${item.relativePath} pivot minY must be grounded at 0`);
      assert.equal(item.centeredOk, true, `${item.relativePath} must be horizontally centered`);
      assert.ok(item.triangleCount > 0, `${item.relativePath} must have triangles`);
      assert.ok(item.materialCount >= 4, `${item.relativePath} must retain PBR materials`);
      assert.ok(item.textureCount >= 2, `${item.relativePath} must include embedded textures`);
      assert.ok(item.imageMimeTypes.includes('image/png'), `${item.relativePath} images must be PNG`);
    }

    // Verify strict LOD triangle reduction (lod0 > lod1 > lod2) for every single model family
    const byFamily = new Map<string, Record<string, number>>();
    for (const item of items) {
      const k = `${item.faction}:${item.modelSlug}`;
      const row = byFamily.get(k) ?? {};
      row[item.lod] = item.triangleCount;
      byFamily.set(k, row);
    }
    assert.equal(byFamily.size, 12, 'Must contain 12 distinct military model families (6 NORTH + 6 SOUTH)');
    for (const [family, tris] of byFamily.entries()) {
      assert.ok(
        tris.lod0 > tris.lod1 && tris.lod1 > tris.lod2,
        `${family} must strictly reduce triangles lod0 (${tris.lod0}) > lod1 (${tris.lod1}) > lod2 (${tris.lod2})`
      );
    }
  });

  it('maps NORTH vs SOUTH models distinctly, upgrades Cơ giới II (motor2) cleanly, and honestly tracks the 8 missing GLB slots', () => {
    assert.equal(CAMPAIGN_READY_GLB_ENTRIES.length, 12);
    assert.equal(CAMPAIGN_MISSING_GLB_ENTRIES.length, 8);
    assert.equal(CAMPAIGN_UNIT_ASSET_MANIFEST.length, 20);

    // Every READY entry's 3 LOD files must exist on disk with exact matching byte size
    for (const entry of CAMPAIGN_READY_GLB_ENTRIES) {
      const lods = entry.lods;
      assert.ok(lods, `${entry.id} must define lods`);
      if (!lods) continue;
      for (const lod of ['lod0', 'lod1', 'lod2'] as const) {
        const lodMeta: GlbLodMetadata = lods[lod];
        const abs = path.join(unitsRoot, lodMeta.relativePath);
        assert.equal(fs.existsSync(abs), true, `Missing GLB file: ${abs}`);
        assert.equal(fs.statSync(abs).size, lodMeta.sizeBytes, `Byte size mismatch on ${lodMeta.relativePath}`);
      }
    }

    // Missing GLB slots must NEVER be marked READY
    const missingPairs = new Set(CAMPAIGN_MISSING_GLB_ENTRIES.map((e) => `${e.faction}:${e.unitKey}`));
    for (const fac of ['NORTH', 'SOUTH'] as const) {
      for (const key of ['sam', 'fighter', 'corvette', 'submarine'] as const) {
        assert.ok(missingPairs.has(`${fac}:${key}`), `Missing GLB ${fac}:${key} must be explicitly tracked`);
        const resolved = resolveCampaignUnitVisual(fac, key, [key]);
        assert.equal(resolved.glbStatus, 'MISSING_GLB');
        assert.equal(resolved.lods, null);
      }
    }

    // Faction visual differentiation across all ground units
    assert.equal(resolveCampaignUnitVisual('NORTH', 'reserve').modelSlug, 'pavn_infantry');
    assert.equal(resolveCampaignUnitVisual('SOUTH', 'reserve').modelSlug, 'arvn_infantry');
    assert.equal(resolveCampaignUnitVisual('NORTH', 'recon').modelSlug, 'pt76');
    assert.equal(resolveCampaignUnitVisual('SOUTH', 'recon').modelSlug, 'v100_commando');
    assert.equal(resolveCampaignUnitVisual('NORTH', 'artillery').modelSlug, 'howitzer_m30_122mm');
    assert.equal(resolveCampaignUnitVisual('SOUTH', 'artillery').modelSlug, 'howitzer_m101_105mm');
    assert.equal(resolveCampaignUnitVisual('NORTH', 'tank').modelSlug, 't54_55');
    assert.equal(resolveCampaignUnitVisual('SOUTH', 'tank').modelSlug, 'm48a3_patton');

    // Cơ giới II (motor2) MUST upgrade visual model for both NORTH and SOUTH
    assert.equal(resolveCampaignUnitVisual('NORTH', 'motor', ['motor']).modelSlug, 'btr40');
    assert.equal(resolveCampaignUnitVisual('NORTH', 'motor', ['motor', 'motor2']).modelSlug, 'btr60pb');
    assert.equal(resolveCampaignUnitVisual('SOUTH', 'motor', ['motor']).modelSlug, 'm113_apc');
    assert.equal(resolveCampaignUnitVisual('SOUTH', 'motor', ['motor', 'motor2']).modelSlug, 'm113_acav');

    // Zoom-driven LOD transitions
    assert.equal(selectVisualLodForZoom(1.0), 'SYMBOL');
    assert.equal(selectVisualLodForZoom(1.5), 'SYMBOL');
    assert.equal(selectVisualLodForZoom(1.8), 'LOD2');
    assert.equal(selectVisualLodForZoom(2.6), 'LOD1');
    assert.equal(selectVisualLodForZoom(4.0), 'LOD0');
  });

  it('produces valid Three.js unit3d bundle and keeps standalone index.html fallback intact', () => {
    const bundlePath = path.join(repoRoot, 'public/assets/unit3d.bundle.js');
    assert.equal(fs.existsSync(bundlePath), true, 'public/assets/unit3d.bundle.js must be built');
    assert.ok(fs.statSync(bundlePath).size > 100_000, 'unit3d.bundle.js must include Three.js runtime');

    const builtHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
    assert.ok(builtHtml.includes('id="unit3d"'), 'index.html must mount #unit3d WebGL overlay canvas');
    assert.ok(builtHtml.includes('id="toggle3dUnits"'), 'index.html must provide 3D toggle in settings');
    assert.ok(builtHtml.includes('unit3dBridge'), 'index.html must include unit3dBridge with offline fallback');
  });
});
