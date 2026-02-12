// WhaleModel.tsx
"use client";

import React, { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";
import * as THREE from "three";

const WHALE_MODEL_URL = "/blue_whale.glb";

const WhaleModel = () => {
  const groupRef = useRef<THREE.Group>(null);
  const tailRef = useRef<THREE.Object3D>(null);
  const { scene, animations } = useGLTF(WHALE_MODEL_URL);
  const { actions, mixer } = useAnimations(animations, groupRef);
  
  // Memoized values for stable references
  const timeOffset = useMemo(() => Math.random() * Math.PI * 2, []);
  
  // Constants for smooth motion
  const SWIM_SPEED = 0.12;
  const SWIM_RANGE = 18;
  const BOB_SPEED = 0.25;
  const BOB_AMOUNT = 1.2;
  const ROTATION_AMOUNT = 0.04;
  const TAIL_WIGGLE_SPEED = 1.3;
  const TAIL_WIGGLE_AMOUNT = 0.18;

  // Animation initialization
  useEffect(() => {
    const swimAction = actions.Swim || actions.swim || 
                      (animations[0] && actions[animations[0].name]);
    
    if (swimAction) {
      swimAction.play();
      swimAction.setEffectiveTimeScale(0.85);
      swimAction.clampWhenFinished = true;
    }

    // Set up tail reference for optimized updates
    if (groupRef.current) {
      const tail = groupRef.current.getObjectByName("WhaleTail") || 
                   groupRef.current.getObjectByName("Tail") ||
                   groupRef.current.getObjectByName("tail");
      if (tail) tailRef.current = tail;
    }

    return () => {
      // Clean up animations
      mixer.stopAllAction();
    };
  }, [actions, animations, mixer]);

  // Optimized useFrame with lerp for smooth motion
  useFrame((state, delta) => {
    if (!groupRef.current) return;

    const time = state.clock.getElapsedTime();
    
    // Smooth horizontal swimming with sinusoidal easing
    const targetX = Math.sin(time * SWIM_SPEED + timeOffset) * SWIM_RANGE;
    const currentX = groupRef.current.position.x;
    groupRef.current.position.x = THREE.MathUtils.lerp(currentX, targetX, 0.05);
    
    // Vertical bobbing with eased motion
    const targetY = Math.sin(time * BOB_SPEED) * BOB_AMOUNT - 2.8;
    const currentY = groupRef.current.position.y;
    groupRef.current.position.y = THREE.MathUtils.damp(currentY, targetY, 10, delta);
    
    // Gentle rotation matching swimming direction
    const targetRotY = Math.sin(time * SWIM_SPEED * 0.5 + timeOffset) * ROTATION_AMOUNT;
    const currentRotY = groupRef.current.rotation.y;
    groupRef.current.rotation.y = THREE.MathUtils.lerp(currentRotY, targetRotY, 0.08);
    
    // Tail wiggle for extra realism
    if (tailRef.current) {
      tailRef.current.rotation.x = Math.sin(time * TAIL_WIGGLE_SPEED) * TAIL_WIGGLE_AMOUNT;
    }
    
    // Efficient mixer update with delta time
    if (mixer) {
      mixer.update(delta * 0.9);
    }
  });

  // Helper function for material optimization
  function optimizeMaterial(material: THREE.Material) {
    if (material instanceof THREE.MeshStandardMaterial) {
      material.color = new THREE.Color("#69d0ff");
      material.emissive = new THREE.Color("#0a0a1f");
      material.emissiveIntensity = 0.25;
      material.roughness = 0.75;
      material.metalness = 0.25;
      material.dithering = false; // Performance optimization
      material.precision = "lowp"; // For mobile optimization
    }
  }

  // Clone scene to prevent mutations on original
  const clonedScene = useMemo(() => {
    const cloned = scene.clone();
    
    // Optimize materials for performance
    cloned.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        // Remove shadows completely
        child.castShadow = false;
        child.receiveShadow = false;
        child.frustumCulled = true;
        
        // Optimize material properties
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(mat => optimizeMaterial(mat));
          } else {
            optimizeMaterial(child.material);
          }
        }
      }
    });
    
    return cloned;
  }, [scene]);

  return (
    <primitive 
      ref={groupRef}
      object={clonedScene}
      position={[0, -2.8, 0]}
      scale={[0.75, 0.75, 0.75]} // Optimized scale for background
      rotation={[0, Math.PI / 3, 0]} // Initial angled rotation
      frustumCulled={true}
    />
  );
};

// Preload model for immediate display
useGLTF.preload(WHALE_MODEL_URL);

export default WhaleModel;