import { type VRM, VRMExpression, VRMExpressionMorphTargetBind } from "@pixiv/three-vrm";
import type * as THREE from "three";

// Cute faces built from the face shapes every VRoid export carries (the Fcl_*
// morph targets). VRM presets only cover happy, angry, sad, relaxed and
// surprised, which is not enough for a pout or a smug little grin.
//
// Each face is two expressions: `${name}` moves the eyes and brows and
// `${name}Mouth` the mouth, so the mouth can make way for lip sync while she talks.

type Weights = Record<string, number>;

export const CUTE_FACES = {
  pout: { eyes: { Fcl_BRW_Angry: 0.55, Fcl_EYE_Angry: 0.15 }, mouth: { Fcl_MTH_Small: 0.85, Fcl_MTH_Angry: 0.45 } },
  smug: { eyes: { Fcl_EYE_Fun: 0.45, Fcl_BRW_Fun: 0.5 }, mouth: { Fcl_MTH_Fun: 0.75, Fcl_MTH_SkinFung: 1 } },
  wink: { eyes: { Fcl_EYE_Joy_R: 1, Fcl_BRW_Fun: 0.4 }, mouth: { Fcl_MTH_Fun: 0.6, Fcl_MTH_SkinFung: 1 } },
  sparkle: { eyes: { Fcl_EYE_Surprised: 0.5, Fcl_BRW_Surprised: 0.5 }, mouth: { Fcl_MTH_Joy: 0.6 } },
  beam: { eyes: { Fcl_EYE_Joy: 1, Fcl_BRW_Joy: 0.6 }, mouth: { Fcl_MTH_Joy: 0.85 } },
  shy: { eyes: { Fcl_EYE_Sorrow: 0.3, Fcl_BRW_Sorrow: 0.6 }, mouth: { Fcl_MTH_Small: 0.5 } },
} satisfies Record<string, { eyes: Weights; mouth: Weights }>;

export type CuteFace = keyof typeof CUTE_FACES;

/** What each cute face falls back to on a model without VRoid face shapes, in VRM preset names. */
const PRESET_FALLBACK: Record<CuteFace, Weights> = {
  pout: { angry: 0.3, sad: 0.15 },
  smug: { happy: 0.35, relaxed: 0.35 },
  wink: { blinkRight: 1, happy: 0.3 },
  sparkle: { happy: 0.6, surprised: 0.3 },
  beam: { happy: 1 },
  shy: { sad: 0.2, relaxed: 0.35 },
};

function bindAll(vrm: VRM, expression: VRMExpression, meshes: THREE.Mesh[], weights: Weights): boolean {
  let bound = 0;
  for (const [morph, weight] of Object.entries(weights)) {
    for (const mesh of meshes) {
      const index = mesh.morphTargetDictionary?.[morph];
      if (index === undefined) continue;
      expression.addBind(new VRMExpressionMorphTargetBind({ primitives: [mesh], index, weight }));
      bound++;
    }
  }
  if (!bound) return false;
  vrm.scene.add(expression);
  vrm.expressionManager?.registerExpression(expression);
  return true;
}

/** Register the cute faces this model has the shapes for; returns their names. */
export function registerCuteFaces(vrm: VRM): Set<CuteFace> {
  const meshes: THREE.Mesh[] = [];
  vrm.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.morphTargetDictionary && Object.keys(mesh.morphTargetDictionary).some((k) => k.startsWith("Fcl_"))) {
      meshes.push(mesh);
    }
  });
  const made = new Set<CuteFace>();
  if (!meshes.length || !vrm.expressionManager) return made;
  for (const [name, face] of Object.entries(CUTE_FACES) as Array<[CuteFace, (typeof CUTE_FACES)[CuteFace]]>) {
    const eyes = bindAll(vrm, new VRMExpression(name), meshes, face.eyes);
    const mouth = bindAll(vrm, new VRMExpression(`${name}Mouth`), meshes, face.mouth);
    if (eyes || mouth) made.add(name);
  }
  return made;
}

/**
 * Expand a face goal that may name cute faces into real expression weights.
 * Mouth parts are scaled by `mouth` so lip sync can show through while she talks.
 */
export function expandFace(goal: Weights, available: Set<CuteFace>, mouth: number): Weights {
  const out: Weights = {};
  const add = (k: string, v: number) => {
    out[k] = Math.min(1, (out[k] ?? 0) + v);
  };
  for (const [key, weight] of Object.entries(goal)) {
    if (key in CUTE_FACES) {
      const face = key as CuteFace;
      if (available.has(face)) {
        add(face, weight);
        add(`${face}Mouth`, weight * mouth);
      } else {
        for (const [k, v] of Object.entries(PRESET_FALLBACK[face])) add(k, v * weight);
      }
    } else {
      add(key, key === "happy" ? weight * (0.45 + 0.55 * mouth) : weight);
    }
  }
  return out;
}
