import type * as THREE from 'three';

/** Lets non-React code (exporters, AI snapshot) reach the live 3D renderer. */
export const view3dRegistry: {
  gl?: THREE.WebGLRenderer;
  scene?: THREE.Scene;
  camera?: THREE.Camera;
  /** Pick a plan point (x,y in meters) from client coordinates. */
  pickFloor?: (clientX: number, clientY: number) => { x: number; y: number } | null;
} = {};

/** Custom uploaded models, normalized (bottom-center at origin). Keyed by model id. */
export const customModelObjects = new Map<string, THREE.Object3D>();
